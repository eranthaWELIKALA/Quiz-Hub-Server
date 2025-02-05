const express = require('express');
const http = require('http');
const axios = require('axios');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
});

const port = 5000;

app.use(express.json());

// Enable CORS for HTTP requests
app.use(cors());

let quizzes = {};
let activeSessions = {};

let score = 1000;
let firstAnswerReceived = false;
const correctAnswer = "jenkins";
let users = [];
let winners = [
];

function decreaseScore() {
    setInterval(() => {
        if (score > 0) {
            score -= 1;
            console.log(`Score: ${score}`);
        }
    }, 100);
}

function sortWinners() {
    winners.sort((a, b) => b.score - a.score);
    winners.forEach((winner, index) => {
        winner.id = index + 1;
    });
}

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

            const defaultTime = { questionDuration: 30, answeringDuration: 10 };
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

        io.emit('next-question', { sessionId, question });

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

app.post('/submit', async (req, res) => {
    try {
        if (!req.body.email || !req.body.name || !req.body.answer) {
            return res.status(400).json({ error: 'Invalid submission data.' });
        }
        if (users.includes(req.body.email)) {
            return res.status(400).json({ error: 'You have already submitted an answer.' });
        } else {
            users.push(req.body.email);
        }
        if (!firstAnswerReceived) {
            firstAnswerReceived = true;
            decreaseScore();
        }
        let userScore = score;

        const { name, answer } = req.body;
        if (correctAnswer == answer) {
            try {
                await axios.post(
                    `http://localhost:8080/generic-webhook-trigger/invoke?token=atlink-cicd-demo`,
                    { name: name }
                );
            } catch (error) {
                console.log('Error while triggering jenkins pipeline:', error.response?.data || error.message);
            }
            winners.push({ name, score: userScore });
            sortWinners();
            io.emit('winners', winners);
        }
        res.status(200).json({ message: 'Answer submitted successfully!' });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: 'Unknown Error!' });
    }
});

io.on('connection', (socket) => {
    console.log('A user connected');

    // Send the current winners list to the new client when they connect
    sortWinners();
    socket.emit('winners', winners);

    socket.on('join-quiz', ({ sessionId }) => {
        socket.join(sessionId);
        console.log(`User joined quiz session: ${sessionId}`);
    });

    socket.on('start-quiz', ({ quizId }, callback) => {
        const sessionId = uuidv4();
        activeSessions[sessionId] = { quizId, currentQuestionIndex: 0, users: [] };
        callback({ sessionId });
    });

    socket.on('join-quiz-host', ({ sessionId }) => {
        socket.join(sessionId);
        console.log(`Host joined quiz session ${sessionId}`);
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
                activeSessions[sessionId].currentQuestionIndex++;
                firstAnswerReceived = false;
                score = 1000;
            }
            else {
                io.to(sessionId).emit('quiz-ended');
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
        io.to(sessionId).emit('reveal-answer');  // Broadcast to all clients in the session
        console.log(`Reveal answer in session ${sessionId}`);
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
        if (!firstAnswerReceived) {
            firstAnswerReceived = true;
            decreaseScore();
        }

        let userScore = score;

        if (!quizzes[quizId] || !quizzes[quizId][currentQuestionIndex]) {
            console.log(`Invalid quiz id or no quizes created yet`);
            return;
        }
        const questionData = quizzes[quizId][currentQuestionIndex];
        // Check if the answer is correct
        if (questionData.correctAnswer === parseInt(answer)) {
            let winnerIndex = winners.findIndex(w => w.id === user.userId);
            if (winnerIndex !== -1) {
                winners[winnerIndex].score = userScore;
            }
            else {
                winners.push({ id: user.userId, name: user.name, score: userScore });
            }

            // Sort winners by score (higher score first)
            winners.sort((a, b) => b.score - a.score);

            // Emit updated winners list
            io.emit('winners', winners);
        }
        else {            
            winners.push({ id: user.userId, name: user.name, score: 0 });

            // Sort winners by score (higher score first)
            winners.sort((a, b) => b.score - a.score);
        }

        // Emit updated winners list
        io.emit('winners', winners);
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});

server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
