const $ = document.querySelector.bind(document);

const log = (...args) => (logs.innerText += args.join(" ") + "\n");

// get the current user's audio stream
function getAudioStream() {
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

// play an audio stream
function playAudioStream(stream, target) {
  // create the video element for the stream
  const elem = document.createElement("video");
  elem.srcObject = stream;
  elem.autoplay = "autoplay";
  elem.setAttribute("data-peer", target);
  elem.onloadedmetadata = () => elem.play();

  // add it to the stream container
  $(".audiostream-container").appendChild(elem);
}

const socket = io();
let id, peer;

// create peer, setup handlers
function initPeer() {
  peer = new Peer(id, {
    host: location.hostname,
    port: location.port,
    path: "/peerjs",
  });

  peer.on("open", (id) => {
    log("My peer ID is:", id);
  });
  peer.on("disconnected", (id) => {
    log("lost connection");
  });
  peer.on("error", (err) => {
    console.error(err);
  });

  // run when someone calls us. answer the call
  peer.on("call", async (call) => {
    log("call from", call.peer);
    call.answer(await getAudioStream());
    receiveCall(call);
  });
}

// start a call with target
async function startCall(target) {
  if (!peer) return;
  const call = peer.call(target, await getAudioStream());
  receiveCall(call);
}

// play the stream from the call in a video element
function receiveCall(call) {
  call.on("stream", (stream) => {
    // stream.noiseSuppression = true;
    playAudioStream(stream, call.peer);
    log("created stream for", call.peer);
  });
}

// setup peer when user receives id
socket.on("id", async (connId) => {
  // this only happens if we lose connection with the server
  if (id) {
    log("destroying old identity", id, "and replacing with", connId);
    peer.destroy();
    peer = undefined;
    return;
  }

  id = connId;
  initPeer();
});

// talk to any user who joins
socket.on("join", (target) => {
  log("calling", target);
  startCall(target);
});

socket.on("leave", (target) => {
  const elem = $(`[data-peer="${target}"]`);
  log("call dropped from", target);
  if (elem) elem.remove();
});
