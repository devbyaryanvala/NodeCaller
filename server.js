// server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const PORT = process.env.PORT || 8080; // Use Render's port or 8080 for local
const HOST = '0.0.0.0'; // Listen on all available network interfaces

// Create an HTTP server
const httpServer = http.createServer((req, res) => {
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html'; // Serve index.html by default for '/'
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        // Add other MIME types if you have CSS, images, etc.
        // '.css': 'text/css',
        // '.png': 'image/png',
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                fs.readFile('./404.html', (err404, content404) => { // Optional: a 404.html page
                    res.writeHead(404, { 'Content-Type': 'text/html' });
                    if (err404) {
                        res.end("404 Not Found (custom 404 page also not found)", 'utf-8');
                    } else {
                        res.end(content404, 'utf-8');
                    }
                });
            } else {
                res.writeHead(500);
                res.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// Create a WebSocket server and attach it to the HTTP server
const wss = new WebSocket.Server({ server: httpServer }); // Key change: attach to httpServer

const rooms = {}; // Store call rooms and their participants
// const PORT = 8080; // Define the port once

console.log(`HTTP and WebSocket server started on http://localhost:${PORT} and ws://localhost:${PORT}`);
console.log(`Access from other devices on the network via this machine's local IP, e.g., http://<your_local_ip>:${PORT}`);


wss.on('connection', ws => {
    console.log("Client connected via WebSocket");
    let currentCallIdForClient = null;

    ws.on('message', messageString => {
        let message;
        try {
            message = JSON.parse(messageString);
        } catch (e) {
            console.error("Failed to parse message:", messageString, e);
            return;
        }

        // Assign callId for this client based on the first relevant message
        if (!currentCallIdForClient && (message.callId || message.targetCallId)) {
            currentCallIdForClient = message.callId || message.targetCallId;
            ws.callId = currentCallIdForClient; // Keep track of the room the WebSocket is in
        }


        console.log("Received WebSocket message:", message);

        switch (message.type) {
            case 'create_room':
                if (!rooms[message.callId]) {
                    rooms[message.callId] = [ws];
                    console.log(`Room created: ${message.callId}. Clients in room: ${rooms[message.callId].length}`);
                    ws.send(JSON.stringify({ type: 'room_created', callId: message.callId }));
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room already exists' }));
                }
                break;

            case 'join_room':
                if (rooms[message.callId]) {
                    if (rooms[message.callId].length < 2) { // Simple 2-person call
                        rooms[message.callId].push(ws);
                        console.log(`Client joined room: ${message.callId}. Clients in room: ${rooms[message.callId].length}`);

                        const otherUser = rooms[message.callId].find(client => client !== ws);
                        if (otherUser && otherUser.readyState === WebSocket.OPEN) {
                            otherUser.send(JSON.stringify({ type: 'user_joined', fromCallId: message.callId }));
                            console.log(`Notified user in room ${message.callId} that another user joined.`);
                        }
                        ws.send(JSON.stringify({ type: 'joined_room', callId: message.callId }));
                    } else {
                        ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
                    }
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room does not exist' }));
                }
                break;

            case 'offer':
            case 'answer':
            case 'candidate':
                const targetRoomId = message.targetCallId;
                if (rooms[targetRoomId]) {
                    const targetRoom = rooms[targetRoomId];
                    targetRoom.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            const typeToRelay = message.type === 'offer' ? 'offer_received' :
                                                message.type === 'answer' ? 'answer_received' :
                                                'candidate_received';
                            client.send(JSON.stringify({ ...message, type: typeToRelay, fromCallId: ws.callId || "unknown" }));
                            console.log(`Relayed ${message.type} from client in ${ws.callId || "unknown"} to other client in room ${targetRoomId}`);
                        }
                    });
                } else {
                     console.log(`Room ${targetRoomId} not found for relaying ${message.type}`);
                }
                break;

            // Add a leave_room handler
            case 'leave_room':
                console.log(`Client from room ${message.callId} sent leave_room message.`);
                handleClientDisconnect(ws); // Reuse disconnect logic
                break;
        }
    });

    function handleClientDisconnect(departingWs) {
        const callId = departingWs.callId; // Use the stored callId
        console.log(`Client from room ${callId} disconnected or left.`);
        if (callId && rooms[callId]) {
            rooms[callId] = rooms[callId].filter(client => client !== departingWs);
            console.log(`Client removed from room ${callId}. Remaining clients: ${rooms[callId].length}`);

            if (rooms[callId].length === 0) {
                delete rooms[callId];
                console.log(`Room ${callId} is now empty and removed.`);
            } else {
                // Notify the remaining user
                rooms[callId].forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'user_left', fromCallId: callId }));
                        console.log(`Notified remaining user in ${callId} about disconnection.`);
                    }
                });
            }
        } else {
            console.log("Disconnected client was not in a specific room, or room was already cleared.");
        }
    }

    ws.on('close', () => {
        console.log("WebSocket client connection closed.");
        handleClientDisconnect(ws);
    });

    ws.on('error', (error) => {
        console.error("WebSocket error:", error);
        // Consider cleaning up if the error is related to a specific client/room
    });
});

// Start the HTTP server
httpServer.listen(PORT, HOST, () => { // Add HOST here
    console.log(`Server is listening on <span class="math-inline">\{HOST\}\:</span>{PORT}`);
    // The code to print local IP addresses is mostly for local dev,
    // Render will give you a public URL.
    // You can keep it or comment it out for cleaner Render logs.
    if (process.env.NODE_ENV !== 'production') { // Only show local IPs if not in production
        const { networkInterfaces } = require('os');
        const nets = networkInterfaces();
        console.log("For local development, you might use one of these IPs:");
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                if (net.family === 'IPv4' && !net.internal) {
                    console.log(`  Interface <span class="math-inline">\{name\}\: http\://</span>{net.address}:${PORT}`);
                }
            }
        }
    }
});