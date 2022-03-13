const $ = document.querySelector.bind(document);
const log = (...args) => (logs.innerText += args.join(" ") + "\n");
const SOUND_CUTOFF_RANGE = 100;
const SOUND_NEAR_RANGE = 10;

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(";").shift();
}

const socket = io({
  auth: {
    token: getCookie("token"),
  },
});

// KEEP JUST IN CASE
const myPos = { x: 0, y: 0 };
const lastPos = { x: 0, y: 0 };
const cursor = { down: false, x: 0, y: 0 };

const players = [];

function calcVolumes(listenerPos, soundPos) {
  // calulate angle and distance from listener to sound
  const theta = Math.atan2(
    soundPos.y - listenerPos.y,
    soundPos.x - listenerPos.x
  );
  const dist = Math.hypot(
    soundPos.y - listenerPos.y,
    soundPos.x - listenerPos.x
  );
  const scale =
    1 - (dist - SOUND_NEAR_RANGE) / (SOUND_CUTOFF_RANGE - SOUND_NEAR_RANGE);

  // target is too far away, no volume
  if (dist > SOUND_CUTOFF_RANGE) return [0, 0];

  // target is very close, max volume
  if (dist < SOUND_NEAR_RANGE) return [1, 1];

  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  return [
    (Math.pow(cos < 0 ? cos : 0, 2) + Math.pow(sin, 2)) * scale,
    (Math.pow(cos > 0 ? cos : 0, 2) + Math.pow(sin, 2)) * scale,
  ];
}

window.addEventListener("load", function(){
    for (const p of players) {
      if (p.stream) {
        // console.log(calcVolumes(myPos, p.pos));
        const [left, right] = calcVolumes(myPos, p.pos);
        p.stream.setVolume(left, right);
      }
    }
});

// get the current user's audio stream
function getAudioStream() {
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

// split an audio stream into left and right channels
class StreamSplit {
  constructor(stream, { left = 1, right = 1 } = {}) {
    this.stream = stream;

    // create audio context using the stream as a source
    const track = stream.getAudioTracks()[0];
    this.context = new AudioContext();
    this.source = this.context.createMediaStreamSource(
      new MediaStream([track])
    );

    // create a channel for each ear (left, right)
    this.channels = {
      left: this.context.createGain(),
      right: this.context.createGain(),
    };

    // connect the gains
    this.source.connect(this.channels.left);
    this.source.connect(this.channels.right);

    // create a merger to join the two gains
    const merger = this.context.createChannelMerger(2);
    this.channels.left.connect(merger, 0, 0);
    this.channels.right.connect(merger, 0, 1);

    // set the volume for each side
    this.setVolume(left, right);

    // connect the merger to the audio context
    merger.connect(this.context.destination);

    this.destination = this.context.createMediaStreamDestination();
  }

  // set the volume
  setVolume(left = 0, right = 0) {
    // clamp volumes between 0 and 1
    left = Math.max(Math.min(left, 1), 0);
    right = Math.max(Math.min(right, 1), 0);

    // disable the stream if the volume is 0
    this.stream.enabled = left !== 0 && right !== 0;

    // set the volumes for each channel's gain
    this.channels.left.gain.value = left;
    this.channels.right.gain.value = right;
  }

  // close the context, stop the audio
  close() {
    return this.context.close();
  }
}

// play an audio stream
function playAudioStream(stream, target) {
  // create the video element for the stream
  const elem = document.createElement("video");
  elem.srcObject = stream;
  elem.muted = true;
  elem.setAttribute("data-peer", target);
  elem.onloadedmetadata = () => elem.play();

  // add it to the stream container
  $(".audiostream-container").appendChild(elem);
}


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
    const player = players.find((p) => p.id === call.peer);
    if (!player) {
      console.log("couldn't find player for stream", call.peer);
    } else {
      player.stream = new StreamSplit(stream, { left: 1, right: 1 });
      playAudioStream(stream, call.peer);
      log("created stream for", call.peer);
    }
    // playAudioStream(stream, call.peer);
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
socket.on("join", (target, pos) => {
  log("calling", target);
  players.push({ id: target, avatar: 0, pos, goal: { x: pos.x, y: pos.y } });
  startCall(target);
});

socket.on("players", (existingPlayers) => {
  for (const p of existingPlayers) {
    players.push({
      id: p.id,
      avatar: 0,
      pos: p.pos,
      goal: { x: p.pos.x, y: p.pos.y },
    });
  }
});

socket.on("pos", (id, pos) => {
  const player = players.find((p) => p.id === id);
  if (player) {
    player.goal.x = pos.x;
    player.goal.y = pos.y;
  }
});

socket.on("leave", (target) => {
  log("call dropped from", target);
  const elem = $(`[data-peer="${target}"]`);
  if (elem) elem.remove();

  // remove player from players list
  const index = players.findIndex((p) => p.id === target);
  if (index > -1) {
    // close the stream
    if (players[index].stream) players[index].stream.close();
    players.splice(index, 1);
  }
});
