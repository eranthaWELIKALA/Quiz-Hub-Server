const express = require('express');
const http = require('http');
const axios = require('axios');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
});

const port = process.env.PORT || 5000;

app.use(express.json());

// Enable CORS for HTTP requests
app.use(cors());

let quizzes = {};
let activeSessions = {};
let intervals = {};

function decreaseScore(sessionId) {
    intervals[sessionId] = setInterval(() => {
        if (activeSessions[sessionId].score > 100) {
            activeSessions[sessionId].score -= 1;
            console.log(`Score[${sessionId}]: ${activeSessions[sessionId].score}`);
        }
    }, 100);
}

function stopDecreasingScore(sessionId) {
    if (intervals[sessionId]) {
        clearInterval(intervals[sessionId]);
    }
}

function sortWinners(sessionId) {
    if (activeSessions[sessionId]) {
        activeSessions[sessionId].winners.sort((a, b) => b.score - a.score);
    }
}

app.get('/sessions', (req, res) => {
    res.status(200).json(activeSessions);
})

app.get('/get-quizes', (req, res) => {
    res.status(200).json(quizzes);
})

app.post('/create-quiz', (req, res) => {
    try {
        const { questions } = req.body;

        if (!Array.isArray(questions) || questions.length === 0) {
            return res.status(400).json({ error: 'Invalid request. "questions" must be a non-empty array.' });
        }

        const processedQuestions = questions.map((q, index) => {
            if (!q.question || !Array.isArray(q.answers) || q.answers.length < 2 || q.answers.length > 4 || q.correctAnswer === undefined) {
                return { error: `Invalid question format at index ${index}.` };
            }
            if (q.correctAnswer < 0 || q.correctAnswer >= q.answers.length) {
                return { error: `Invalid correct answer index at index ${index}.` };
            }

            const defaultTime = { questionDuration: 5, answeringDuration: 20 };
            q.time = q.time || defaultTime;

            return q;
        });

        const errors = processedQuestions.filter(q => q.error);
        if (errors.length > 0) {
            return res.status(400).json({ errors });
        }

        const quizId = uuidv4();
        quizzes[quizId] = processedQuestions;

        res.status(200).json({ message: 'Quiz created successfully', quizId });
    } catch (error) {
        console.error('Error processing questions:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/start-quiz', (req, res) => {
    try {
        const { quizId } = req.body;

        if (!quizId || !quizzes[quizId]) {
            return res.status(400).json({ error: 'Invalid or non-existent quizId' });
        }

        const sessionId = uuidv4();
        activeSessions[sessionId] = { quizId, users: [] };

        res.status(200).json({ message: 'Quiz session started', sessionId: sessionId });
    } catch (error) {
        console.error('Error starting quiz session:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/join-quiz', (req, res) => {
    try {
        const { name, sessionId } = req.body;

        if (!name || !sessionId) {
            return res.status(400).json({ error: 'Name and sessionId are required.' });
        }

        if (!activeSessions[sessionId]) {
            return res.status(400).json({ error: 'Invalid sessionId.' });
        }

        // Generate a unique user ID
        const userId = uuidv4();

        // Store the user in the session
        activeSessions[sessionId].users.push({ userId, name });
        activeSessions[sessionId].winners.push({ id: userId, name: name, score: 0 });
        io.to(sessionId).emit('winners', activeSessions[sessionId].winners);

        res.status(200).json({ message: 'User registered successfully!', userId });
    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/next-question', (req, res) => {
    try {
        const { sessionId, question } = req.body;

        if (!sessionId || !question) {
            return res.status(400).json({ error: 'Quiz session ID and question are required.' });
        }

        if (!activeSessions[sessionId]) {
            return res.status(400).json({ error: 'Invalid quiz session ID.' });
        }

        io.to(sessionId).emit('next-question', { sessionId, question });

        res.status(200).json({ message: 'Next question sent successfully!' });
    } catch (error) {
        console.error('Error emitting next question:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/leaderboard', (req, res) => {
    try {
        const { sessionId } = req.query;

        if (!sessionId) {
            return res.status(400).json({ error: 'Quiz session ID is required.' });
        }

        if (!activeSessions[sessionId]) {
            return res.status(400).json({ error: 'Invalid quiz session ID.' });
        }

        const leaderboard = activeSessions[sessionId].users
            .sort((a, b) => b.score - a.score)
            .map(({ name, score }) => ({ name, score }));

        res.status(200).json({ leaderboard });
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/trigger-jenkins', async (req, res) => {
    const { sessionId } = req.body; // Extract sessionId from the request body
    triggerJenkinsWebhook(sessionId);
    res.status(200).json({ message: 'Jenkins server triggered successfully!' });
});

const triggerJenkinsWebhook = async (sessionId) => {
    try {
        try {
            sortWinners(sessionId); // You can use sessionId here
            await axios.post(
                `${process.env.JENKINS_URL}/generic-webhook-trigger/invoke?token=${process.env.JENKINS_TOKEN}`,
                { name: activeSessions[sessionId].winners[0] || "Unknown" }
            );
        } catch (error) {
            console.log('Error while triggering jenkins pipeline:', error.response?.data || error.message);
        }
    } catch (error) {
        console.log(error);
    }
}

io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('retrieve-winners', ({ sessionId }) => {
        if (activeSessions[sessionId]) {
            socket.join(sessionId);
            sortWinners(sessionId);
            io.to(sessionId).emit('winners', activeSessions[sessionId].winners);
        }
    });

    socket.on('join-quiz', ({ sessionId }, callback) => {
        if (activeSessions[sessionId]) {
            socket.join(sessionId);
            console.log(`User joined quiz session: ${sessionId}`);
            callback({ success: true, message: 'Joined successfully' });
        }
        else {
            callback({ success: false, message: 'Invalid quiz ID' });
        }
    });

    socket.on('start-quiz', ({ quizId }, callback) => {
        const sessionId = uuidv4();
        activeSessions[sessionId] = { quizId, currentQuestionIndex: 0, users: [], firstAnswerReceived: false, score: 1000, winners: [] };
        callback({ sessionId });
    });

    socket.on('join-quiz-host', ({ sessionId }) => {
        if (activeSessions[sessionId]) {
            socket.join(sessionId);
            console.log(`Host joined quiz session ${sessionId}`);
        }
    });

    socket.on('next-question', ({ sessionId }) => {
        if (!activeSessions[sessionId] || (!quizzes[activeSessions[sessionId].quizId])) {
            if (!socket.rooms.has(sessionId)) {
                socket.join(sessionId);
            }
            io.to(sessionId).emit('invalid-quiz-id');
        }
        else if (activeSessions[sessionId]) {
            const { quizId, currentQuestionIndex } = activeSessions[sessionId];
            const questionData = quizzes[quizId][currentQuestionIndex];

            if (questionData) {
                io.to(sessionId).emit('next-question', questionData);
                stopDecreasingScore(sessionId);
                activeSessions[sessionId].currentQuestionIndex++;
                activeSessions[sessionId].firstAnswerReceived = false;
                activeSessions[sessionId].score = 1000;
            }
            else {
                io.to(sessionId).emit('quiz-ended');
                triggerJenkinsWebhook(sessionId);
            }
        }
        else {
            if (!socket.rooms.has(sessionId)) {
                socket.join(sessionId);
            }
            io.to(sessionId).emit('quiz-ended');
        }
    });

    socket.on('reveal-answer', ({ sessionId }) => {
        if (activeSessions[sessionId]) {
            io.to(sessionId).emit('reveal-answer');  // Broadcast to all clients in the session
            console.log(`Reveal answer in session ${sessionId}`);
        }
    });

    socket.on('submit-answer', ({ sessionId, userId, answer }) => {
        // Ensure session and users exist
        if (!activeSessions[sessionId] || !activeSessions[sessionId].users) {
            console.log(`Session ${sessionId} not found or has no users.`);
            return;
        }

        let { quizId, currentQuestionIndex, users } = activeSessions[sessionId];
        currentQuestionIndex = currentQuestionIndex - 1;
        // Find user info
        const user = users.find(u => u.userId === userId);
        if (!user) {
            console.log(`User ${userId} not found in session ${sessionId}`);
            return;
        }

        // If first answer is received, decrease score
        if (!activeSessions[sessionId].firstAnswerReceived) {
            activeSessions[sessionId].firstAnswerReceived = true;
            decreaseScore(sessionId);
        }

        let userScore = activeSessions[sessionId].score;

        if (!quizzes[quizId] || !quizzes[quizId][currentQuestionIndex]) {
            console.log(`Invalid quiz id or no quizes created yet`);
            return;
        }
        const questionData = quizzes[quizId][currentQuestionIndex];
        // Check if the answer is correct
        if (questionData.correctAnswer === parseInt(answer)) {
            let winnerIndex = activeSessions[sessionId].winners.findIndex(w => w.id === user.userId);
            if (winnerIndex !== -1) {
                activeSessions[sessionId].winners[winnerIndex].score += userScore;
            }
            else {
                activeSessions[sessionId].winners.push({ id: user.userId, name: user.name, score: userScore });
            }
        }
        else {
            let winnerIndex = activeSessions[sessionId].winners.findIndex(w => w.id === user.userId);
            if (winnerIndex === -1) {
                activeSessions[sessionId].winners.push({ id: user.userId, name: user.name, score: 0 });
            }
        }

        // Sort winners by score (higher score first)
        sortWinners(sessionId);

        // Emit updated winners list
        io.to(sessionId).emit('winners', activeSessions[sessionId].winners);
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});

server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
