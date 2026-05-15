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
const cheerio = require('cheerio');

const app = express();

const PORT = process.env.PORT || 3001;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// ============================================
// ⚙️ MIDDLEWARES
// ============================================
app.use(cors());

app.use(express.json({
    limit: '2mb'
}));

app.use(express.static(__dirname));

app.use(session({
    secret: process.env.SESSION_SECRET || 'emptor-secret-key-2026',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
}));

// ============================================
// 🏠 HOME
// ============================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================
// 🧹 LIMPIAR HISTORIAL
// ============================================
app.post('/api/clear-history', (req, res) => {

    if (req.session) {
        req.session.conversationHistory = [];
    }

    res.json({
        ok: true
    });

});

// ============================================
// 📊 FEEDBACK
// ============================================
app.post('/api/feedback', (req, res) => {

    try {

        const {
            type,
            question,
            answer,
            timestamp
        } = req.body;

        const feedbackFile = path.join(__dirname, 'feedback.json');

        let feedbacks = [];

        if (fs.existsSync(feedbackFile)) {

            try {
                feedbacks = JSON.parse(
                    fs.readFileSync(feedbackFile, 'utf8')
                );
            } catch (e) {
                feedbacks = [];
            }

        }

        feedbacks.push({
            type,
            question: (question || '').substring(0, 500),
            answer: (answer || '').substring(0, 500),
            timestamp: timestamp || new Date().toISOString()
        });

        if (feedbacks.length > 1000) {
            feedbacks = feedbacks.slice(-1000);
        }

        fs.writeFileSync(
            feedbackFile,
            JSON.stringify(feedbacks, null, 2)
        );

        console.log(`📊 Feedback registrado: ${type}`);

        res.json({
            ok: true
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: 'Error guardando feedback'
        });

    }

});

// ============================================
// 📚 CARGA DE FALLOS LOCALES
// ============================================
let fallos = [];

try {

    const fallosRaw = fs.readFileSync(
        path.join(__dirname, 'fallos.json'),
        'utf8'
    );

    fallos = JSON.parse(fallosRaw);

    console.log(`📚 Fallos cargados: ${fallos.length}`);

} catch (e) {

    console.warn('⚠️ No se pudo cargar fallos.json');

}

// ============================================
// 🔍 BÚSQUEDA LOCAL DE FALLOS
// ============================================
function buscarFallosLocal(query, maxResultados = 3) {

    if (!fallos.length) return [];

    const stopWords = [
        'que', 'como', 'para', 'por',
        'con', 'sin', 'el', 'la',
        'los', 'las', 'un', 'una',
        'de', 'a', 'y', 'o', 'u'
    ];

    const palabras = query
        .toLowerCase()
        .split(/\s+/)
        .filter(p => p.length > 3)
        .filter(p => !stopWords.includes(p));

    const resultados = fallos.map(fallo => {

        let score = 0;

        const texto = `
            ${fallo.titulo || ''}
            ${fallo.resumen_breve || ''}
            ${(fallo.palabras_clave || []).join(' ')}
        `.toLowerCase();

        for (const palabra of palabras) {

            if (texto.includes(palabra)) {
                score += 10;
            }

        }

        if (fallo.tribunal?.includes('Suprema')) {
            score += 20;
        }

        if (fallo.tribunal?.includes('Apelaciones')) {
            score += 10;
        }

        return {
            fallo,
            score
        };

    });

    resultados.sort((a, b) => b.score - a.score);

    return resultados
        .slice(0, maxResultados)
        .map(r => r.fallo);

}

// ============================================
// 🌐 BÚSQUEDA EN SERNAC
// ============================================
async function buscarSernac(query) {

    try {

        const url =
            `https://www.sernac.cl/portal/604/w3-search.html?query=${encodeURIComponent(query)}`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });

        const html = await response.text();

        const $ = cheerio.load(html);

        const resultados = [];

        $('a').each((i, el) => {

            const titulo = $(el).text().trim();

            const link = $(el).attr('href');

            if (
                titulo &&
                titulo.length > 15 &&
                link &&
                link.includes('/portal/')
            ) {

                resultados.push({
                    titulo,
                    link: link.startsWith('http')
                        ? link
                        : `https://www.sernac.cl${link}`
                });

            }

        });

        return resultados.slice(0, 5);

    } catch (error) {

        console.error('❌ Error buscando en SERNAC:', error);

        return [];

    }

}

// ============================================
// 🤖 CHAT PRINCIPAL
// ============================================
app.post('/api/chat', async (req, res) => {

    try {

        const {
            messages
        } = req.body;

        if (!OPENROUTER_API_KEY) {

            return res.status(500).json({
                error: 'Falta OPENROUTER_API_KEY'
            });

        }

        if (!req.session.conversationHistory) {
            req.session.conversationHistory = [];
        }

        if (messages && messages.length > 0) {

            req.session.conversationHistory.push(
                messages[messages.length - 1]
            );

        }

        const history =
            req.session.conversationHistory.slice(-10);

        const userQuery =
            messages?.length
                ? messages[messages.length - 1].content
                : '';

        // ============================================
        // 🔍 BUSCAR FALLOS
        // ============================================
        const fallosRelevantes =
            buscarFallosLocal(userQuery, 3);

        // ============================================
        // 🌐 BUSCAR EN SERNAC
        // ============================================
        const resultadosSernac =
            await buscarSernac(userQuery);

        // ============================================
        // 🧠 CONTEXTO JURÍDICO
        // ============================================
        let contexto = '';

        // --------------------------------------------
        // FALLOS
        // --------------------------------------------
        if (fallosRelevantes.length > 0) {

            contexto += '\n\n📋 JURISPRUDENCIA LOCAL:\n';

            fallosRelevantes.forEach((f, idx) => {

                contexto += `
${idx + 1}. ${f.titulo || 'Sin título'}
Tribunal: ${f.tribunal || 'No informado'}
Fecha: ${f.fecha || 'No disponible'}
ROL: ${f.rol || 'No disponible'}
Principio: ${f.principio_juridico || 'No disponible'}
Resultado: ${f.resultado || 'No disponible'}
`;

            });

        }

        // --------------------------------------------
        // SERNAC
        // --------------------------------------------
        if (resultadosSernac.length > 0) {

            contexto += '\n\n🌐 FUENTES OFICIALES SERNAC:\n';

            resultadosSernac.forEach((r, idx) => {

                contexto += `
${idx + 1}. ${r.titulo}
Fuente: ${r.link}
`;

            });

        }

        // ============================================
        // 🧾 SYSTEM PROMPT
        // ============================================
        const systemPrompt = `
Eres "Emptor", asistente jurídico chileno especializado en derecho del consumidor.

REGLAS OBLIGATORIAS:

1. Responde SOLO usando:
- normativa chilena;
- jurisprudencia proporcionada;
- fuentes oficiales.

2. NO INVENTES:
- artículos;
- fallos;
- roles;
- fechas;
- tribunales.

3. Si no tienes información suficiente:
di expresamente:
"No tengo información verificable suficiente sobre ese punto."

4. Diferencia claramente:
- ley;
- jurisprudencia;
- criterio administrativo;
- explicación general.

5. La jurisprudencia chilena NO es precedente vinculante general.
La Corte Suprema tiene alta relevancia jurisprudencial.

6. Si usas información de SERNAC:
indica que corresponde a orientación administrativa.

7. Usa tono:
- técnico;
- prudente;
- preciso.

8. No afirmes certezas absolutas
cuando existan interpretaciones discutidas.

CONTEXTO JURÍDICO:

${contexto}
`;

        // ============================================
        // 📤 MENSAJES A IA
        // ============================================
        const messagesForAI = [
            {
                role: 'system',
                content: systemPrompt
            },
            ...history
        ];

        // ============================================
        // 🤖 OPENROUTER
        // ============================================
        const response = await fetch(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                method: 'POST',

                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'HTTP-Referer': 'https://emptor.onrender.com',
                    'X-Title': 'Emptor'
                },

                body: JSON.stringify({
                    model: 'openrouter/free',
                    messages: messagesForAI,
                    temperature: 0.1,
                    max_tokens: 3000
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {

            throw new Error(
                data.error?.message || 'Error OpenRouter'
            );

        }

        const assistant =
            data.choices[0].message;

        req.session.conversationHistory.push(
            assistant
        );

        res.json({
            choices: [
                {
                    message: assistant
                }
            ]
        });

    } catch (error) {

        console.error('❌ Error /api/chat:', error);

        res.status(500).json({
            error: error.message
        });

    }

});

// ============================================
// 🚀 START SERVER
// ============================================
app.listen(PORT, '0.0.0.0', () => {

    console.log(`
╔══════════════════════════════════════════════╗
║ 🇨🇱 Emptor iniciado correctamente 🇨🇱        ║
╠══════════════════════════════════════════════╣
║ 🌐 Puerto: ${PORT}
║ 📚 Fallos locales: ${fallos.length}
║ 🔎 Fuente oficial: SERNAC
║ 🔐 OpenRouter: ${OPENROUTER_API_KEY ? 'OK' : 'FALTANTE'}
╚══════════════════════════════════════════════╝
`);

});

// ============================================
// 💥 ERRORES GLOBALES
// ============================================
process.on('uncaughtException', (err) => {

    console.error('💥 Error no capturado:', err);

});

process.on('unhandledRejection', (reason) => {

    console.error('💥 Promesa rechazada:', reason);

});