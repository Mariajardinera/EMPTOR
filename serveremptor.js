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
const { search } = require('duckduckgo-search');

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
// 📚 CARGA DE JURISPRUDENCIA LOCAL (fallos.json)
// ============================================
let fallos = [];
try {
    const fallosRaw = fs.readFileSync(path.join(__dirname, 'fallos.json'), 'utf8');
    fallos = JSON.parse(fallosRaw);
    console.log(`📚 Cargados ${fallos.length} fallos locales`);
} catch (e) {
    console.warn('⚠️ No se pudo cargar fallos.json. Búsqueda local limitada.');
}

// ============================================
// 🔍 BÚSQUEDA LOCAL POR PALABRAS CLAVE
// ============================================
function buscarFallosLocal(query, maxResultados = 3) {
    if (!fallos.length) return [];
    const palabras = query.toLowerCase().split(/\s+/).filter(p => p.length > 3);
    const stopWords = ['que', 'como', 'para', 'por', 'con', 'sin', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'a', 'y', 'o', 'u'];
    const palabrasFiltradas = palabras.filter(p => !stopWords.includes(p));
    
    const resultados = fallos.map(fallo => {
        let score = 0;
        const texto = (fallo.titulo + ' ' + fallo.resumen_breve + ' ' + (fallo.palabras_clave || []).join(' ')).toLowerCase();
        for (const palabra of palabrasFiltradas) {
            if (texto.includes(palabra)) score += 10;
        }
        if (fallo.fecha) {
            const antiguedad = (new Date() - new Date(fallo.fecha)) / (1000 * 60 * 60 * 24);
            score += Math.max(0, 100 - antiguedad);
        }
        if (fallo.tribunal && fallo.tribunal.includes('Suprema')) score += 20;
        else if (fallo.tribunal && fallo.tribunal.includes('Apelaciones')) score += 15;
        return { fallo, score };
    });
    resultados.sort((a,b) => b.score - a.score);
    return resultados.slice(0, maxResultados).map(r => r.fallo);
}

// ============================================
// 🌐 BÚSQUEDA WEB CON DUCKDUCKGO (GRATIS, SIN API KEY)
// ============================================
async function buscarWeb(query) {
    try {
        const results = await search(query, { safeSearch: false });
        if (!results || results.length === 0) return [];
        return results.slice(0, 3).map(r => ({
            titulo: r.title || 'Sin título',
            link: r.url || '#',
            snippet: r.snippet || 'Sin descripción'
        }));
    } catch (error) {
        console.error('Error en búsqueda web:', error);
        return [];
    }
}

// ============================================
// 🤖 ENDPOINT PRINCIPAL
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
        
        const userQuery = messages && messages.length ? messages[messages.length - 1].content : '';
        
        // FASE 1: búsqueda local
        let fallosRelevantes = buscarFallosLocal(userQuery, 3);
        let jurisprudenciaTexto = '';
        let resultadosWeb = [];

        if (fallosRelevantes.length === 0) {
            // FASE 2: búsqueda web
            resultadosWeb = await buscarWeb(userQuery);
            if (resultadosWeb.length > 0) {
                jurisprudenciaTexto = '\n\n**🌐 RESULTADOS DE BÚSQUEDA WEB (fuentes externas):**\n';
                resultadosWeb.forEach((item, idx) => {
                    jurisprudenciaTexto += `${idx+1}. **${item.titulo}**\n`;
                    jurisprudenciaTexto += `   - Enlace: ${item.link}\n`;
                    jurisprudenciaTexto += `   - Extracto: ${item.snippet}\n`;
                });
                jurisprudenciaTexto += '\n⚠️ **Importante:** Estos resultados son de fuentes externas. Revisa los enlaces para verificar la información.';
            } else {
                jurisprudenciaTexto = '\n\n**⚠️ No se encontraron fallos en la base de datos local ni en la web para esta consulta.**\n\nTe recomiendo buscar manualmente en:\n- www.pjud.cl (Portal del Poder Judicial)\n- www.sernac.cl (SERNAC)\n- www.microjuris.cl (con suscripción)';
            }
        } else {
            // Hay resultados locales
            jurisprudenciaTexto = '\n\n**📋 JURISPRUDENCIA RELEVANTE (desde base local):**\n';
            fallosRelevantes.forEach((f, idx) => {
                jurisprudenciaTexto += `${idx+1}. **${f.titulo}** (${f.tribunal}, ${f.fecha || 'fecha no disponible'})\n`;
                jurisprudenciaTexto += `   - Resultado: ${f.resultado}\n`;
                jurisprudenciaTexto += `   - Principio: ${f.principio_juridico}\n`;
                jurisprudenciaTexto += `   - ROL: ${f.rol}\n`;
                if (f.palabras_clave) jurisprudenciaTexto += `   - Palabras clave: ${f.palabras_clave.join(', ')}\n`;
            });
        }

        // System prompt actualizado con instrucciones claras sobre temas de consumo y prohibición de inventar
        const systemPrompt = `Eres "Emptor", un asistente experto en derecho del consumidor chileno (Ley 19.496) y en jurisprudencia real de tribunales chilenos.

**🔴 TEMAS QUE DEBES RESPONDER NORMALMENTE (CON CONOCIMIENTO LEGAL):**
- Problemas con bancos, cheques, créditos, tarjetas, tasas de interés, TMC, cobranzas.
- Discriminación arbitraria en el consumo (edad, apariencia, tatuajes, discapacidad, etc.).
- Negativa de servicio, garantías, cláusulas abusivas, SERNAC.
- Liberación de hipotecas después de pagar la deuda.
- Garantía legal de productos electrónicos y cualquier producto.
- **Derecho a retracto (artículo 3 bis de la Ley 19.496)**: compras por internet, ventas a distancia, plazo de 10 días para arrepentirse, devolución del dinero, etc.
- Todo lo relacionado con la Ley 19.496, Ley 18.010 (solo para tasas), circulares de la CMF y del SERNAC.

**🟢 SOLO ACTIVA MENSAJE OFF‑TOPIC SI LA PREGUNTA ES CLARAMENTE AJENA** (deportes, farándula, política no consumo, medicina no relacionada). 
- **NO actives off-topic para preguntas sobre derecho a retracto, compras online, ventas a distancia, plazos de desistimiento, etc.**

⚠️ **INSTRUCCIÓN ABSOLUTA - NUNCA, BAJO NINGUNA CIRCUNSTANCIA, INVENTES INFORMACIÓN.**
- SI NO TIENES UN DATO EXACTO (un artículo de ley, un fallo, un rol, un tribunal, una fecha, un monto), RESPONDE HONESTAMENTE: "No tengo información fidedigna sobre eso en mi base de conocimiento."
- NUNCA inventes números de rol, tribunales, fechas o artículos de leyes.
- La información que puedes usar es SOLO la que aparece en la sección "JURISPRUDENCIA RELEVANTE" (local o web) y las leyes chilenas citadas explícitamente.

**JERARQUÍA DE TRIBUNALES (importancia de los fallos):**
1. Corte Suprema → precedente vinculante
2. Corte de Apelaciones → jurisprudencia regional
3. TDLC → libre competencia
4. Juzgados Civiles → casos concretos
5. Juzgados de Policía Local → sumarios

**FLUJO DE RESPUESTA OBLIGATORIO:**
1. IDENTIFICA palabras clave, proveedor y conflicto.
2. BUSCA en la jurisprudencia proporcionada.
3. Si NO encuentras un fallo relevante, RESPONDE: "No encontré un fallo exacto en mi base de datos ni en la web. Te recomiendo buscar en www.pjud.cl o consultar a un abogado."
4. Si SÍ encuentras un fallo relevante, RESPONDE usando EXACTAMENTE este formato:

✅ **Principio jurídico:** [cita ley o circular]
📋 **Fallo de referencia:** [Partes], [Tribunal], [Fecha], ROL [número o "sin número de rol público"]
💡 **Aplicación a tu caso:** [análisis concreto]
⚠️ **Consideraciones:** [limitaciones o advertencias]

Si los resultados provienen de una búsqueda web, incluye el enlace fuente.

**REGLAS ADICIONALES:**
- Usa enumeraciones claras (1, 2, 3...).
- Termina SIEMPRE con: "⚖️ **Aviso educativo**: Respuesta basada en fuentes oficiales chilenas y jurisprudencia real. No constituye asesoría legal. Verifica con abogado o SERNAC."

Ahora, la jurisprudencia relevante para esta consulta se entregará a continuación. SOLO USA ESA INFORMACIÓN. NO INVENTES NADA.

${jurisprudenciaTexto}

Responde la consulta del usuario.`;

        const messagesForAI = [{ role: 'system', content: systemPrompt }, ...history];
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'HTTP-Referer': 'https://emptor.onrender.com',
                'X-Title': 'Emptor'
            },
            body: JSON.stringify({ model: 'openrouter/free', messages: messagesForAI, temperature: 0.1, max_tokens: 4000 })
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ╔══════════════════════════════════════════════════════════════════╗
    ║   🇨🇱 Emptor - Búsqueda local + web (DuckDuckGo, gratis) 🇨🇱        ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║  🌐 Puerto: ${PORT}                                                  ║
    ║  ✅ Búsqueda local: ${fallos.length} fallos                          ║
    ║  ✅ Búsqueda web: DuckDuckGo (sin API key, gratis)                 ║
    ║  ✅ Incluye derecho a retracto y todos los temas de consumo        ║
    ║  🔐 API Key OpenRouter: ${OPENROUTER_API_KEY ? '✅ CONFIGURADA' : '❌ FALTANTE'}         ║
    ╚══════════════════════════════════════════════════════════════════╝
    `);
});

process.on('uncaughtException', (err) => {
    console.error('💥 Error no capturado:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('💥 Promesa rechazada:', reason);
});