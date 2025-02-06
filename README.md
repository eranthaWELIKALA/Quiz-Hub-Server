# ⚡ Quiz Hub – Backend (Node.js + Express.js) 🎯  

This is the **backend server** for **Quiz Hub**, a real-time multiplayer quiz game. It handles **quiz creation, session management, real-time communication** via **Socket.io**, and scoring logic.  

## 🚀 Features  
- 🔌 **Real-time WebSockets** – Built with **Socket.io** for instant communication.  
- 🎭 **Session Management** – Admins can create quiz sessions with a unique ID.  
- ⏳ **Timed Questions** – Each question has a countdown before moving to the next.  
- ⚡ **Speed-Based Scoring** – Faster answers earn more points.  
- 📊 **Live Leaderboard** – Updates dynamically as players answer questions.  

## 🛠️ Tech Stack  
- **Node.js** – JavaScript runtime  
- **Express.js** – Backend framework  
- **Socket.io** – Real-time WebSocket communication  
- **dotenv** – For environment variables  

## 📦 Installation & Setup  

### 1️⃣ Clone the Repository  
```bash
git clone https://github.com/yourusername/quiz-hub-backend.git
cd quiz-hub-backend
```
## 2️⃣ Install Dependencies
```bash
npm install
```

## 3️⃣ Configure Environment Variables
Create a .env file in the project root and set the required variables:
```ini
PORT=5000
MONGO_URI=mongodb://localhost:27017/quizhub
```

## 4️⃣ Start the Server
### Development Mode
```bash
npm run dev
```
Runs using *nodemon* for automatic restarts on file changes.

### Production Mode
```bash
npm start
```
Runs the server normally.

# 🔗 API Endpoints
- POST    /api/quiz	            Create a new quiz session
- GET     /api/quiz/:id	        Fetch quiz details by ID
- POST	  /api/join	            Join a quiz session
- POST	  /api/answer	          Submit an answer
- GET	    /api/leaderboard/:id	Get live leaderboard

# 📌 How It Works
1. Admin creates a quiz session and gets a unique Quiz ID.
2. Players join using the Session ID and wait for the quiz to start.
3. Questions appear one by one, and players select answers before the timer ends.
4. Points are awarded based on speed, and the leaderboard updates live.
