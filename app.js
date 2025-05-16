// --- DOM Elements ---
const createCallButton = document.getElementById('createCallButton');
const joinCallButton = document.getElementById('joinCallButton');
const callIdInput = document.getElementById('callIdInput');
const uniqueCallIdDisplay = document.getElementById('uniqueCallIdDisplay');
const callStatus = document.getElementById('callStatus');
const localAudio = document.getElementById('localAudio');
const remoteAudio = document.getElementById('remoteAudio');
const muteButton = document.getElementById('muteButton');
const endCallButton = document.getElementById('endCallButton');
const setupControls = document.getElementById('setupControls');
const callControls = document.getElementById('callControls');
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(`<span class="math-inline">\{protocol\}//</span>{window.location.host}`);

// --- WebRTC and Signaling Variables ---
let localStream;
let peerConnection;
let currentCallId;
let isMuted = false;

// ** IMPORTANT: Make sure this matches your signaling server address **
// If server.js is on the same machine, 'ws://localhost:8080' is correct.
// If on a different machine on your LAN, use 'ws://<server_machine_ip>:8080'
// const socket = new WebSocket('ws://192.168.20.159:8080');

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // You might need a TURN server for more reliable connections across different networks.
        // {
        //   urls: 'turn:your.turn.server.com:port',
        //   username: 'user',
        //   credential: 'password'
        // }
    ]
};

// --- Event Listeners for Buttons ---
createCallButton.addEventListener('click', createCall);
joinCallButton.addEventListener('click', joinCall);
muteButton.addEventListener('click', toggleMute);
endCallButton.addEventListener('click', endCurrentCall);

// --- WebSocket Event Handlers ---
socket.onopen = () => {
    console.log("WebSocket connection established.");
    // You could enable UI elements here if they were initially disabled
};

socket.onmessage = async (event) => {
    const message = JSON.parse(event.data);
    console.log("Received message from signaling server:", message);
    await handleSignalingData(message);
};

socket.onerror = (error) => {
    console.error("WebSocket error:", error);
    callStatus.textContent = "Connection error. Please refresh and check server.";
    alert("WebSocket connection error. See console for details.");
};

socket.onclose = () => {
    console.log("WebSocket connection closed.");
    if (currentCallId) { // If the call was active when socket closed
        callStatus.textContent = "Connection lost. Call ended.";
        resetCallState();
    }
};

// --- Core WebRTC and Call Logic ---

async function startMedia() {
    try {
        if (!localStream) { // Get stream only if not already present
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            localAudio.srcObject = localStream; // Show local audio (muted by default in HTML to prevent echo)
        }
        console.log("Media stream obtained.");
    } catch (e) {
        console.error("Error accessing media devices.", e);
        callStatus.textContent = "Error accessing microphone: " + e.message;
        alert("Could not access microphone. Please check permissions. " + e.message);
        throw e; // Re-throw to stop call setup if media fails
    }
}

function generateUniqueId() {
    return Math.random().toString(36).substring(2, 9); // Simple ID
}

async function createPeerConnection() {
    if (peerConnection) {
        console.log("Closing existing peer connection before creating new one.");
        peerConnection.close();
    }
    peerConnection = new RTCPeerConnection(configuration);
    console.log("RTCPeerConnection created.");

    // Add local tracks to the connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            console.log("Adding local track:", track);
            peerConnection.addTrack(track, localStream);
        });
    } else {
        console.error("Local stream not available to add tracks.");
        alert("Error: Local media stream is not available.");
        return; // Exit if no local stream
    }


    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            console.log("Sending ICE candidate:", event.candidate);
            socket.send(JSON.stringify({
                type: 'candidate',
                candidate: event.candidate,
                targetCallId: currentCallId
            }));
        }
    };

    peerConnection.ontrack = event => {
        console.log("Remote track received:", event.streams[0]);
        if (event.streams && event.streams[0]) {
            remoteAudio.srcObject = event.streams[0];
            callStatus.textContent = "Call connected!";
        } else {
            // Fallback if no streams[0] but tracks exist (less common for audio-only)
            if (!remoteAudio.srcObject && event.track) {
                const newStream = new MediaStream();
                newStream.addTrack(event.track);
                remoteAudio.srcObject = newStream;
                callStatus.textContent = "Call connected (track directly)!";
            }
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log("ICE connection state change:", peerConnection.iceConnectionState);
        switch (peerConnection.iceConnectionState) {
            case "connected":
                callStatus.textContent = "Call connected!";
                break;
            case "disconnected":
                callStatus.textContent = "Call disconnected. Attempting to reconnect...";
                // You might implement reconnection logic here or rely on WebSocket close
                break;
            case "failed":
                callStatus.textContent = "Call failed. Please try again.";
                endCurrentCall(); // End the call on failure
                break;
            case "closed":
                callStatus.textContent = "Call closed.";
                // Resetting is usually handled in endCurrentCall or WebSocket close
                break;
        }
    };
}

async function createCall() {
    if (socket.readyState !== WebSocket.OPEN) {
        alert("Signaling server not connected. Please wait or refresh.");
        return;
    }
    try {
        await startMedia();
    } catch (e) {
        return; // Stop if media access failed
    }

    currentCallId = generateUniqueId();
    uniqueCallIdDisplay.textContent = currentCallId;
    callStatus.textContent = "Creating call... Share this ID: " + currentCallId;
    console.log("Creating call with ID:", currentCallId);

    socket.send(JSON.stringify({ type: 'create_room', callId: currentCallId }));

    // createPeerConnection will be called after 'room_created' or similar ack from server
    // to ensure the server is ready for offers.
    // Or, create it here and then send offer after room confirmation.
    // For this example, let's assume room_created will trigger next steps.

    setupControls.style.display = 'none';
    callControls.style.display = 'block';
    muteButton.textContent = "Mute";
    isMuted = false;
}

async function joinCall() {
    if (socket.readyState !== WebSocket.OPEN) {
        alert("Signaling server not connected. Please wait or refresh.");
        return;
    }
    const callIdToJoin = callIdInput.value.trim();
    if (!callIdToJoin) {
        alert("Please enter a Call ID to join.");
        return;
    }

    try {
        await startMedia();
    } catch (e) {
        return; // Stop if media access failed
    }

    currentCallId = callIdToJoin;
    uniqueCallIdDisplay.textContent = currentCallId;
    callStatus.textContent = "Joining call: " + currentCallId;
    console.log("Attempting to join call with ID:", currentCallId);

    socket.send(JSON.stringify({ type: 'join_room', callId: currentCallId }));

    // Peer connection will be created and offer/answer handled via signaling.
    setupControls.style.display = 'none';
    callControls.style.display = 'block';
    muteButton.textContent = "Mute";
    isMuted = false;
}

async function handleSignalingData(message) {
    switch (message.type) {
        case 'room_created': // Server acknowledges room creation for the creator
            console.log(`Room ${message.callId} created successfully.`);
            callStatus.textContent = "Room created. Waiting for another user to join with ID: " + message.callId;
            await createPeerConnection(); // Now create PC for the caller
            // The creator will make an offer when another user joins.
            break;

        case 'joined_room': // Server acknowledges you've joined a room (for the joiner)
            console.log(`Successfully joined room ${message.callId}.`);
            callStatus.textContent = "Joined room. Waiting for connection...";
            await createPeerConnection(); // Create PC for the joiner. The offer will come from the other peer.
            break;

        case 'user_joined': // Creator gets this when someone joins their room
            console.log(`User joined your room: ${message.fromCallId}. Creating offer...`);
            callStatus.textContent = "Another user joined! Setting up connection...";
            if (!peerConnection) await createPeerConnection(); // Ensure PC exists
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            console.log("Sending offer:", offer);
            socket.send(JSON.stringify({
                type: 'offer',
                offer: peerConnection.localDescription, // Send the whole localDescription
                targetCallId: currentCallId
            }));
            break;

        case 'offer_received': // Joiner gets this
            console.log("Offer received:", message.offer);
            callStatus.textContent = "Offer received. Setting up connection...";
            if (!peerConnection) await createPeerConnection(); // Ensure PC exists if not already
            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                console.log("Sending answer:", answer);
                socket.send(JSON.stringify({
                    type: 'answer',
                    answer: peerConnection.localDescription, // Send the whole localDescription
                    targetCallId: currentCallId
                }));
            } catch (error) {
                console.error("Error handling offer:", error);
                callStatus.textContent = "Error processing offer. " + error.message;
            }
            break;

        case 'answer_received': // Creator gets this
            console.log("Answer received:", message.answer);
            callStatus.textContent = "Answer received. Connecting...";
            if (!peerConnection.currentRemoteDescription) { // Avoid issues if already set
                try {
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
                } catch (error) {
                    console.error("Error handling answer:", error);
                    callStatus.textContent = "Error processing answer. " + error.message;
                }
            }
            break;

        case 'candidate_received':
            console.log("ICE Candidate received:", message.candidate);
            try {
                if (message.candidate && peerConnection && peerConnection.signalingState !== 'closed') {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
                }
            } catch (e) {
                console.error('Error adding received ICE candidate', e);
            }
            break;

        case 'user_left':
            console.log("Other user left the call.");
            callStatus.textContent = "The other user has left the call.";
            endCurrentCall(false); // Don't send another 'leave' message
            break;

        case 'error':
            console.error("Signaling error:", message.message);
            callStatus.textContent = "Error: " + message.message;
            alert("Server error: " + message.message);
            // Optionally reset call state if it's a fatal error
            if (message.message.includes("Room is full") || message.message.includes("Room does not exist")) {
                resetCallState();
            }
            break;

        default:
            console.log("Unknown message type received:", message.type);
    }
}

function toggleMute() {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
    });
    muteButton.textContent = isMuted ? "Unmute" : "Mute";
    console.log(isMuted ? "Microphone muted" : "Microphone unmuted");
}

function endCurrentCall(notifyServer = true) {
    console.log("Ending call.");
    if (notifyServer && socket.readyState === WebSocket.OPEN && currentCallId) {
        socket.send(JSON.stringify({ type: 'leave_room', callId: currentCallId }));
    }

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        localAudio.srcObject = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (remoteAudio) {
        remoteAudio.srcObject = null;
    }

    resetCallState();
}

function resetCallState() {
    currentCallId = null;
    callIdInput.value = "";
    uniqueCallIdDisplay.textContent = "";
    callStatus.textContent = "Enter Call ID or Create New Call.";
    setupControls.style.display = 'block';
    callControls.style.display = 'none';
    isMuted = false;
    muteButton.textContent = "Mute";
    if (remoteAudio) remoteAudio.srcObject = null; // Ensure remote audio is cleared
    console.log("Call state reset.");
}

// Initial UI state
callControls.style.display = 'none';
setupControls.style.display = 'block';
callStatus.textContent = "Please create or join a call.";

console.log("app.js loaded. Waiting for WebSocket connection...");