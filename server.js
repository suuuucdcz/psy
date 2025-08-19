// server.js
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // utile si Node <18

const app = express();
app.use(cors());
app.use(express.json());

// Stockage en mémoire des conversations
const conversations = new Map();

// Contexte psychologue
const psychologistContext = `
[ROLE] Psychologue clinicien expérimenté
[MISSION] Soutien émotionnel et bien-être mental
[STYLE] Professionnel, empathique et bienveillant
[DIRECTIVES] 
- Pose des questions ouvertes
- Valide les sentiments
- Encourage l'introspection
- Évite les diagnostics médicaux
- Réponses de 4-7 phrases
- Utilise un langage simple et accessible
- Favorise l'exploration des émotions
- Offre un soutien non-jugeant
`;

// Liste d’exercices thérapeutiques
const exercises = [
  {
    id: 'breathing',
    title: "Respiration profonde",
    description: "Un exercice simple pour réduire le stress et l'anxiété",
    duration: 5,
    steps: [
      "Asseyez-vous confortablement, le dos droit",
      "Inspirez profondément par le nez pendant 4 secondes",
      "Retenez votre respiration pendant 4 secondes",
      "Expirez lentement par la bouche pendant 6 secondes",
      "Répétez ce cycle pendant 5 minutes"
    ]
  },
  {
    id: 'mindfulness',
    title: "Méditation de pleine conscience",
    description: "Concentrez-vous sur le moment présent",
    duration: 10,
    steps: [
      "Trouvez un endroit calme et asseyez-vous confortablement",
      "Fermez les yeux et portez attention à votre respiration",
      "Lorsque des pensées surgissent, reconnaissez-les puis laissez-les partir",
      "Concentrez-vous sur les sensations corporelles",
      "Continuez pendant 10 minutes"
    ]
  },
  {
    id: 'gratitude',
    title: "Journal de gratitude",
    description: "Cultivez une attitude reconnaissante",
    duration: 7,
    steps: [
      "Prenez un carnet et un stylo",
      "Listez 3 choses pour lesquelles vous êtes reconnaissant aujourd'hui",
      "Décrivez pourquoi chacune est importante pour vous",
      "Réfléchissez à la sensation de gratitude",
      "Pratiquez cet exercice quotidiennement"
    ]
  }
];

// -------- Fonctions utilitaires --------

// Interroger Hugging Face
async function queryHuggingFace(prompt) {
  const response = await fetch(
    "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.HF_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: 300,
          temperature: 0.7,
          top_p: 0.9
        }
      })
    }
  );

  const data = await response.json();
  if (Array.isArray(data) && data[0]?.generated_text) {
    return data[0].generated_text;
  } else if (data.error) {
    console.error("Erreur Hugging Face:", data.error);
    return "Désolé, une erreur est survenue avec le modèle.";
  } else {
    return "Pas de réponse générée.";
  }
}

// Construire le prompt contextuel
function buildContextPrompt(history) {
  let prompt = psychologistContext + "\n\n[CONVERSATION]";
  history.forEach(entry => {
    const prefix = entry.role === 'user' ? "Patient" : "Psychologue";
    prompt += `\n${prefix}: ${entry.content}`;
  });
  prompt += "\n\nPsychologue:";
  return prompt;
}

// Nettoyage du texte IA
function processAIResponse(text) {
  text = text.trim()
    .replace(/\n{2,}/g, '\n')
    .replace(/\s{2,}/g, ' ')
    .replace(/([.!?])(\s|$)/g, '$1\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(\n\n)$/, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// -------- Routes --------

// Chat principal
app.post('/api/chat', async (req, res) => {
  const { prompt, sessionId } = req.body;

  try {
    const conversationKey = `${sessionId}-pro`;
    if (!conversations.has(conversationKey)) {
      conversations.set(conversationKey, []);
    }

    const history = conversations.get(conversationKey);
    history.push({ role: 'user', content: prompt });

    const contextPrompt = buildContextPrompt(history);

    const rawResponse = await queryHuggingFace(contextPrompt);
    const processedResponse = processAIResponse(rawResponse);

    history.push({ role: 'assistant', content: processedResponse });
    if (history.length > 20) history.splice(0, history.length - 20);
    conversations.set(conversationKey, history);

    res.json({ response: processedResponse });
  } catch (err) {
    console.error("Erreur /api/chat:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Effacer une session
app.get('/api/clear/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const conversationKey = `${sessionId}-pro`;

  if (conversations.has(conversationKey)) {
    conversations.delete(conversationKey);
    res.json({ success: true, message: 'Conversation effacée' });
  } else {
    res.json({ success: false, message: 'Aucune conversation trouvée' });
  }
});

// Analyse émotion
app.post('/api/analyze-emotion', async (req, res) => {
  const { text } = req.body;

  try {
    const emotionPrompt = `
Analyser le texte suivant et identifier l'émotion dominante.
Retourner UN SEUL mot parmi : joie, tristesse, colère, peur, surprise, dégoût, neutre

Texte : ${text}
    `;

    const raw = await queryHuggingFace(emotionPrompt);
    const emotion = raw.toLowerCase().trim();

    const valid = ['joie', 'tristesse', 'colère', 'peur', 'surprise', 'dégoût', 'neutre'];
    res.json({ emotion: valid.includes(emotion) ? emotion : 'neutre' });
  } catch (err) {
    console.error("Erreur /api/analyze-emotion:", err);
    res.status(500).json({ emotion: 'neutre' });
  }
});

// Progression globale d'une session
app.get('/api/progress/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const conversationKey = `${sessionId}-pro`;

  if (!conversations.has(conversationKey)) {
    return res.status(404).json({ error: 'Session non trouvée' });
  }

  const history = conversations.get(conversationKey);

  const emotionCount = {
    joie: 0, tristesse: 0, colère: 0, peur: 0, surprise: 0, dégoût: 0, neutre: 0
  };

  const wordFrequency = {};

  history.forEach(entry => {
    if (entry.emotion) emotionCount[entry.emotion]++;
    if (entry.role === 'user') {
      const words = entry.content.toLowerCase().split(/\s+/);
      words.forEach(word => {
        if (word.length > 3) {
          wordFrequency[word] = (wordFrequency[word] || 0) + 1;
        }
      });
    }
  });

  const sortedWords = Object.entries(wordFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));

  res.json({
    emotionDistribution: emotionCount,
    topWords: sortedWords,
    sessionCount: history.filter(e => e.role === 'user').length,
    avgMessageLength: history.reduce((sum, e) => sum + e.content.length, 0) / history.length
  });
});

// Liste des exercices
app.get('/api/exercises', (req, res) => {
  res.json(exercises);
});

// -------- Lancement --------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur IA Psychologue lancé sur http://localhost:${PORT}`);
});
