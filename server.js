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

// Game State
const players = {};

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // Kapan player bergabung ke arena
    socket.on('join-game', (username) => {
        players[socket.id] = {
            id: socket.id,
            username: username || 'Player',
            x: (Math.random() - 0.5) * 20,
            y: 1, // Ketinggian kubus
            z: (Math.random() - 0.5) * 20,
            rotation: 0,
            health: 100,
            score: 0,
            color: Math.floor(Math.random()*16777215) // Warna acak
        };

        // Beritahu player yang baru join tentang semua player yang ada
        socket.emit('current-players', players);

        // Beritahu player lain bahwa ada player baru
        socket.broadcast.emit('new-player', players[socket.id]);
    });

    // Pergerakan player
    socket.on('player-movement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].z = movementData.z;
            players[socket.id].rotation = movementData.rotation;
        }
    });

    // Menembak
    socket.on('shoot', (targetId) => {
        if (players[targetId] && players[socket.id]) {
            players[targetId].health -= 25; // Damage per tembakan

            if (players[targetId].health <= 0) {
                // Target mati
                players[socket.id].score += 1;
                
                // Respawn target
                players[targetId].health = 100;
                players[targetId].x = (Math.random() - 0.5) * 20;
                players[targetId].z = (Math.random() - 0.5) * 20;

                io.emit('player-killed', {
                    killer: players[socket.id].username,
                    victim: players[targetId].username,
                    victimId: targetId,
                    newPos: { x: players[targetId].x, z: players[targetId].z }
                });
            }

            // Broadcast update health
            io.emit('health-update', {
                id: targetId,
                health: players[targetId].health
            });
        }
    });

    // WebRTC Signaling untuk Voice Chat
    socket.on('voice-offer', (payload) => {
        io.to(payload.target).emit('voice-offer', { caller: socket.id, sdp: payload.sdp });
    });

    socket.on('voice-answer', (payload) => {
        io.to(payload.target).emit('voice-answer', { caller: socket.id, sdp: payload.sdp });
    });

    socket.on('voice-candidate', (payload) => {
        io.to(payload.target).emit('voice-candidate', { caller: socket.id, candidate: payload.candidate });
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        delete players[socket.id];
        io.emit('player-disconnected', socket.id);
    });
});

// Update loop server: kirim posisi semua orang ke semua orang 20 kali per detik
setInterval(() => {
    io.emit('state-update', players);
}, 50); // 50ms = 20 fps server tick

const PORT = process.env.PORT || 3003;
server.listen(PORT, () => console.log(`Game Server running on port ${PORT}`));
