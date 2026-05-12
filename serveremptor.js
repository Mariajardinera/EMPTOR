// ============================================
// 📦 DEPENDENCIAS
// ============================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const fetch = require('node-fetch');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

app.use(session({
    secret: process.env.SESSION_SECRET || 'emptor-secret-key-2026',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.post('/api/clear-history', (req, res) => {
    if (req.session) req.session.conversationHistory = [];
    res.json({ ok: true });
});

app.post('/api/feedback', (req, res) => {
    const { type, question, answer, timestamp } = req.body;
    const feedbackFile = path.join(__dirname, 'feedback.json');
    let feedbacks = [];
    if (fs.existsSync(feedbackFile)) {
        try { feedbacks = JSON.parse(fs.readFileSync(feedbackFile, 'utf8')); } catch(e) {}
    }
    feedbacks.push({ type, question, answer: answer ? answer.substring(0,500) : '', timestamp: timestamp || new Date().toISOString() });
    if (feedbacks.length > 1000) feedbacks = feedbacks.slice(-1000);
    fs.writeFileSync(feedbackFile, JSON.stringify(feedbacks, null, 2));
    console.log(`📊 Feedback: ${type}`);
    res.json({ ok: true });
});

// ============================================
// 🤖 ENDPOINT PRINCIPAL CON KNOWLEDGE BASE CORREGIDA
// ============================================
app.post('/api/chat', async (req, res) => {
    try {
        const { messages } = req.body;
        if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'API key faltante' });

        if (!req.session.conversationHistory) req.session.conversationHistory = [];
        if (messages && messages.length > 0) {
            req.session.conversationHistory.push(messages[messages.length - 1]);
        }
        const history = req.session.conversationHistory.slice(-10);

        const systemPrompt = `Eres "Emptor", un asistente experto en derecho del consumidor chileno. Tu especialidad es la Ley 19.496 (LPC), jurisprudencia real, tasas de interés (TMC) y créditos hipotecarios.

**TEMAS QUE DEBES RESPONDER NORMALMENTE:**
- Problemas con bancos, cheques, créditos, tarjetas, tasas de interés, TMC, cobranzas.
- Discriminación arbitraria en el consumo (edad, apariencia, tatuajes, discapacidad, etc.).
- Negativa de servicio, garantías, cláusulas abusivas, SERNAC.
- Liberación de hipotecas después de pagar la deuda.
- Todo lo relacionado con la Ley 19.496, Ley 18.010 (solo para tasas), circulares de la CMF y del SERNAC.

**SOLO RESPUESTA OFF-TOPIC SI LA PREGUNTA ES CLARAMENTE AJENA** (deportes, farándula, política no consumo). En ese caso responde: "Lo siento, soy Emptor, asistente especializado en consumo chileno. No puedo responder otros temas."

**PROHIBICIONES ABSOLUTAS:**
- NO inventes números de rol de fallos. Si no lo sabes, di "sin número de rol público disponible".
- NO inventes URLs directas a normas. Guía a buscar en sitios oficiales.
- NO inventes artículos de leyes que no existen. Por ejemplo, la Ley 18.010 NO regula plazos de liberación de hipoteca.
- NO menciones la SVS (Superintendencia de Valores y Seguros) porque ya no existe. Usa "CMF" o "SERNAC".

**CÓMO CITAR FUENTES (OBLIGATORIO):**
- Leyes: "Busca en www.bcn.cl/leychile (Ley 19.496 o Ley 18.010)."
- Tasas TMC: "La TMC es publicada por la CMF en www.cmfchile.cl."
- Circulares SERNAC: "En www.sernac.cl – busca Circular N°X."
- Fallos sin rol: "Sin rol público. Busca en www.pjud.cl."

**📚 BASE DE CONOCIMIENTO (SOLO ESTA INFORMACIÓN):**

**Ley 19.496 (LPC):**
- Art. 3.c: No discriminación arbitraria.
- Art. 12: Información previa y por escrito.
- Art. 16 y 17: Cláusulas abusivas.
- Art. 19-22: Garantía legal (3 meses).
- Art. 24: Multas hasta 300 UTM (Juzgados de Policía Local).
- Art. 25A: Indemnización automática por corte de servicios básicos.

**Tasas de interés – TMC (Ley 18.010 y CMF):**
- Créditos de consumo: TMC + 15 puntos.
- Créditos hipotecarios: TMC + 10 puntos.
- Prendarios y descuento de cheques: TMC + 12 puntos.
- B2B: libre negociación.
- Si cobran más: vulnera Ley 18.010 y puede ser cláusula abusiva o discriminación.
- Consulta TMC vigente en www.cmfchile.cl.

**Liberación de hipoteca después de pagar la deuda (fuentes: Código Civil, Circular CMF):**
- No hay un plazo legal único en la LPC o Ley 18.010. El plazo debe ser "razonable" (generalmente 30-45 días hábiles según buenas prácticas bancarias y circulares de la CMF).
- El deudor debe solicitar al banco el certificado de cancelación de la deuda y la escritura de liberación de hipoteca.
- El banco debe tramitar la liberación ante el Conservador de Bienes Raíces. Si se demora sin justificación, puede ser considerado una práctica abusiva (art. 16 LPC).
- Pasos si el banco se demora:
  1. Reclamar ante el banco por escrito.
  2. Denunciar ante el SERNAC (www.sernac.cl).
  3. Eventualmente, demandar por incumplimiento contractual ante tribunales civiles.
- **No cites la Ley 18.010 para plazos** porque no existe ese artículo. No inventes plazos legales que no están escritos.

**Jurisprudencia real:**
- Banco Scotiabank (2025): multa 100 UTM por tasa discriminatoria por edad. Sin rol público.
- H&M (2024): Corte Apelaciones Santiago por negar atención a diputada.
- Tienda retail (2010): sanción por discapacidad.

**Circular SERNAC N°1:** cláusulas que excluyan por características personales pueden ser discriminatorias.

**Consulta LGBTIQ+ SERNAC (2026):** 50% ha sufrido discriminación en consumo; 80% desconoce que puede denunciar.

**REGLAS DE REDACCIÓN:**
- Usa enumeración 1, 2, 3...
- Cuida ortografía.
- Si no tienes información exacta, di: "No tengo información fidedigna sobre eso. Consulta www.sernac.cl o un abogado."
- Termina con: "⚖️ **Aviso educativo**: Respuesta basada en fuentes oficiales chilenas. No constituye asesoría legal. Verifica con abogado o SERNAC."

Ahora responde la consulta del usuario.`;

        const messagesForAI = [{ role: 'system', content: systemPrompt }, ...history];
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'HTTP-Referer': 'https://emptor.onrender.com',
                'X-Title': 'Emptor'
            },
            body: JSON.stringify({ model: 'openrouter/free', messages: messagesForAI, temperature: 0.2, max_tokens: 4000 })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || 'Error en OpenRouter');
        const assistant = data.choices[0].message;
        req.session.conversationHistory.push(assistant);
        res.json({ choices: [{ message: assistant }] });
    } catch (error) {
        console.error('❌ Error en /api/chat:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 🟢 INICIAR SERVIDOR
// ============================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ╔══════════════════════════════════════════════════════════════════╗
    ║   🇨🇱 Emptor - Hipotecas, TMC, discriminación (sin inventar) 🇨🇱    ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║  🌐 Puerto: ${PORT}                                                  ║
    ║  ✅ Prohibición de inventar plazos / artículos falsos               ║
    ║  ✅ Liberación de hipoteca: plazo razonable (NO Ley 18.010)         ║
    ║  🔐 API Key: ${OPENROUTER_API_KEY ? '✅ CONFIGURADA' : '❌ FALTANTE'}         ║
    ╚══════════════════════════════════════════════════════════════════╝
    `);
});

// ============================================
// 🛑 MANEJO DE ERRORES (sintaxis correcta)
// ============================================
process.on('uncaughtException', (err) => {
    console.error('💥 Error no capturado:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('💥 Promesa rechazada:', reason);
});