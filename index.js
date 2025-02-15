const express = require("express");
const http = require("http");
const axios = require("axios");
const { HttpStatusCode } = require("axios");
const socketIo = require("socket.io");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

const port = process.env.PORT || 5000;

app.use(express.json());

// Enable CORS for HTTP requests
app.use(cors());

let quizzes = {};
let activeSessions = {};
let intervals = {};

function generateUniqueCode() {
    let code;
    do {
        code = Math.floor(10000 + Math.random() * 90000);
    } while (
        Object.values(activeSessions).some((session) => session.code === code)
    );
    return code.toString();
}

function decreaseScore(sessionId) {
    intervals[sessionId] = setInterval(() => {
        if (activeSessions[sessionId].score > 100) {
            activeSessions[sessionId].score -= 1;
            console.log(
                `Score[${sessionId}]: ${activeSessions[sessionId].score}`
            );
        } else {
            stopDecreasingScore(sessionId);
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

app.get("/sessions", (req, res) => {
    res.status(HttpStatusCode.Ok).json(activeSessions);
});

app.get("/get-quizes", (req, res) => {
    res.status(HttpStatusCode.Ok).json(quizzes);
});

app.post("/create-quiz", (req, res) => {
    try {
        const { questions } = req.body;

        if (!Array.isArray(questions) || questions.length === 0) {
            return res.status(HttpStatusCode.BadRequest).json({
                error: 'Invalid request. "questions" must be a non-empty array.',
            });
        }

        const processedQuestions = questions.map((q, index) => {
            // Validate question text
            if (typeof q.question !== "string" || q.question.trim() === "") {
                return {
                    error: `Invalid question format at index ${index}. Question must be a non-empty string.`,
                };
            }

            // Validate answers array
            if (
                !Array.isArray(q.answers) ||
                q.answers.length < 2 ||
                q.answers.length > 4
            ) {
                return {
                    error: `Invalid answers at index ${index}. Must be an array with 2 to 4 options.`,
                };
            }

            // Ensure all answer choices are strings
            if (
                !q.answers.every(
                    (ans) => typeof ans === "string" && ans.trim() !== ""
                )
            ) {
                return {
                    error: `Invalid answer choices at index ${index}. All answers must be non-empty strings.`,
                };
            }

            // Validate correctAnswer index
            if (
                typeof q.correctAnswer !== "number" ||
                !Number.isInteger(q.correctAnswer) ||
                q.correctAnswer < 0 ||
                q.correctAnswer >= q.answers.length
            ) {
                return {
                    error: `Invalid correct answer index at index ${index}. Must be an integer within answer choices range.`,
                };
            }

            // Validate time object
            if (
                q.time &&
                (typeof q.time !== "object" ||
                    !q.time.questionDuration ||
                    !q.time.answeringDuration)
            ) {
                return {
                    error: `Invalid time object at index ${index}. Must include questionDuration and answeringDuration.`,
                };
            }

            // Set default time if not provided
            const defaultTime = {
                questionDuration: parseInt(
                    process.env.DEFAULT_QUESTION_DURATION || "5"
                ),
                answeringDuration: parseInt(
                    process.env.DEFAULT_ANSWERING_DURATION || "20"
                ),
            };
            q.time = q.time || defaultTime;

            return q;
        });

        // Collect validation errors
        const errors = processedQuestions.filter((q) => q.error);
        if (errors.length > 0) {
            return res.status(HttpStatusCode.BadRequest).json({ errors });
        }

        // Assign quiz ID and store it
        const quizId = uuidv4();
        quizzes[quizId] = processedQuestions;

        res.status(HttpStatusCode.Ok).json({
            message: "Quiz created successfully",
            quizId,
        });
    } catch (error) {
        console.error("Error processing questions:", error);
        res.status(HttpStatusCode.InternalServerError).json({
            error: "Internal Server Error",
        });
    }
});

app.post("/join-quiz", (req, res) => {
    try {
        let { name, sessionId } = req.body;

        if (!name || !sessionId) {
            return res
                .status(HttpStatusCode.BadRequest)
                .json({ error: "Name and sessionId are required." });
        }

        if (
            !activeSessions[sessionId] &&
            !Object.values(activeSessions).some((session) => session.code == sessionId)
        ) {
            return res
                .status(HttpStatusCode.BadRequest)
                .json({ error: "Invalid sessionId or code." });
        }
        if (!activeSessions[sessionId]) {
            let [id, session] = Object.entries(activeSessions).find(
                ([_, session]) => session.code == sessionId
            );
            sessionId = id;
        }

        // Generate a unique user ID
        const userId = uuidv4();

        // Store the user in the session
        activeSessions[sessionId].users.push({ userId, name, answers: [] });
        activeSessions[sessionId].winners.push({
            id: userId,
            name: name,
            score: 0,
        });
        io.to(sessionId).emit("winners", activeSessions[sessionId].winners);

        res.status(HttpStatusCode.Ok).json({
            message: "User registered successfully!",
            userId,
            sessionId
        });
    } catch (error) {
        console.error("Error registering user:", error);
        res.status(HttpStatusCode.InternalServerError).json({
            error: "Internal Server Error",
        });
    }
});

app.post("/trigger-jenkins", async (req, res) => {
    const { sessionId } = req.body;
    triggerJenkinsWebhook(sessionId);
    res.status(HttpStatusCode.Ok).json({
        message: "Jenkins server triggered successfully!",
    });
});

const triggerJenkinsWebhook = async (sessionId) => {
    try {
        if (
            !activeSessions[sessionId] ||
            !activeSessions[sessionId].winners.length
        ) {
            console.error("No winners found or invalid session ID:", sessionId);
            return;
        }
        sortWinners(sessionId);
        await axios.post(
            `${process.env.JENKINS_URL}/generic-webhook-trigger/invoke?token=${process.env.JENKINS_TOKEN}`,
            { name: activeSessions[sessionId].winners[0] || "Unknown" }
        );
    } catch (error) {
        console.log(
            "Error while triggering jenkins pipeline:",
            error.response?.data || error.message
        );
    }
};

io.on("connection", (socket) => {
    console.log("A user connected");

    socket.on("retrieve-winners", ({ sessionId }) => {
        if (activeSessions[sessionId]) {
            socket.join(sessionId);
            sortWinners(sessionId);
            io.to(sessionId).emit("winners", activeSessions[sessionId].winners);
        }
    });

    socket.on("join-quiz", ({ sessionId }, callback) => {
        if (activeSessions[sessionId]) {
            socket.join(sessionId);
            console.log(`User joined quiz session: ${sessionId}`);
            callback({ success: true, message: "Joined successfully" });
        } else {
            callback({ success: false, message: "Invalid quiz ID" });
        }
    });

    socket.on("start-quiz", ({ quizId }, callback) => {
        const sessionId = uuidv4();
        const sessionCode = generateUniqueCode();
        activeSessions[sessionId] = {
            quizId,
            currentQuestionIndex: 0,
            users: [],
            firstAnswerReceived: false,
            score: 1000,
            winners: [],
            code: sessionCode,
        };
        callback({ sessionId, code: sessionCode });
    });

    socket.on("join-quiz-host", ({ sessionId }) => {
        if (activeSessions[sessionId]) {
            socket.join(sessionId);
            console.log(`Host joined quiz session ${sessionId}`);
        }
    });

    socket.on("next-question", ({ sessionId }) => {
        if (
            !activeSessions[sessionId] ||
            !quizzes[activeSessions[sessionId].quizId]
        ) {
            if (!socket.rooms.has(sessionId)) {
                socket.join(sessionId);
            }
            io.to(sessionId).emit("invalid-quiz-id");
        } else if (activeSessions[sessionId]) {
            const { quizId, currentQuestionIndex } = activeSessions[sessionId];
            const questionData = quizzes[quizId][currentQuestionIndex];

            if (questionData) {
                io.to(sessionId).emit("next-question", questionData);
                stopDecreasingScore(sessionId);
                activeSessions[sessionId].currentQuestionIndex++;
                activeSessions[sessionId].firstAnswerReceived = false;
                activeSessions[sessionId].score = 1000;
            } else {
                io.to(sessionId).emit("quiz-ended");
                triggerJenkinsWebhook(sessionId);
            }
        } else {
            if (!socket.rooms.has(sessionId)) {
                socket.join(sessionId);
            }
            io.to(sessionId).emit("quiz-ended");
        }
    });

    socket.on("reveal-answer", ({ sessionId }) => {
        if (activeSessions[sessionId]) {
            io.to(sessionId).emit("reveal-answer"); // Broadcast to all clients in the session
            console.log(`Reveal answer in session ${sessionId}`);
        }
    });

    socket.on("submit-answer", ({ sessionId, userId, answer }) => {
        // Ensure session and users exist
        if (!activeSessions[sessionId] || !activeSessions[sessionId].users) {
            console.log(`Session ${sessionId} not found or has no users.`);
            return;
        }

        let { quizId, currentQuestionIndex, users } = activeSessions[sessionId];
        currentQuestionIndex = currentQuestionIndex - 1;
        // Find user info
        const user = users.find((u) => u.userId === userId);
        if (!user) {
            console.log(`User ${userId} not found in session ${sessionId}`);
            return;
        } else if (user && user.answers.includes(currentQuestionIndex)) {
            return;
        } else {
            user.answers.push(currentQuestionIndex);
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
            let winnerIndex = activeSessions[sessionId].winners.findIndex(
                (w) => w.id === user.userId
            );
            if (winnerIndex !== -1) {
                activeSessions[sessionId].winners[winnerIndex].score +=
                    userScore;
            } else {
                activeSessions[sessionId].winners.push({
                    id: user.userId,
                    name: user.name,
                    score: userScore,
                });
            }
        } else {
            let winnerIndex = activeSessions[sessionId].winners.findIndex(
                (w) => w.id === user.userId
            );
            if (winnerIndex === -1) {
                activeSessions[sessionId].winners.push({
                    id: user.userId,
                    name: user.name,
                    score: 0,
                });
            }
        }

        // Sort winners by score (higher score first)
        sortWinners(sessionId);

        // Emit updated winners list
        io.to(sessionId).emit("winners", activeSessions[sessionId].winners);
    });

    socket.on("disconnect", () => {
        console.log("A user disconnected");
    });
});

app.use((req, res) => {
    res.status(HttpStatusCode.NotFound).json({ error: "Not Found" });
});

server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
