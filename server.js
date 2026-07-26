const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

io.on('connection', (socket) => {
    let currentRoom = '';
    
    socket.on('join-room', (roomId) => {
        currentRoom = roomId;
        socket.join(roomId);
        socket.to(roomId).emit('user-connected', socket.id);
    });
    
    socket.on('offer', (payload) => {
        io.to(payload.target).emit('offer', payload);
    });

    socket.on('answer', (payload) => {
        io.to(payload.target).emit('answer', payload);
    });

    socket.on('ice-candidate', (incoming) => {
        // Route ICE candidate based on the actual target (strip -screen if present but keep original caller context)
        const actualTarget = incoming.target.replace('-screen', '');
        io.to(actualTarget).emit('ice-candidate', incoming.candidate, incoming.caller);
    });

    socket.on('stop-screen-share', (screenId) => {
        if (currentRoom) {
            socket.to(currentRoom).emit('user-disconnected', screenId);
        }
    });

    socket.on('disconnect', () => {
        if (currentRoom) {
            socket.to(currentRoom).emit('user-disconnected', socket.id);
            // Also disconnect their screen if active
            socket.to(currentRoom).emit('user-disconnected', socket.id + '-screen');
        }
    });
});

const PORT = process.env.PORT || 3003;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
