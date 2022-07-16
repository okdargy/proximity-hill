const $ = document.querySelector.bind(document);
const SOUND_CUTOFF_RANGE = 50;
const SOUND_NEAR_RANGE = 5;

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
var myPos = { x: 0, y: 0 };
var players = [];
var mutedAll = false;

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
  document.body.appendChild(elem);
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
    console.log("My peer ID is:", id);
    selfId = id;
  });
  peer.on("disconnected", (id) => {
    console.log("lost connection");

    // find div element with them and remove it
    const elem = document.querySelector("div[profileId='" + id + "']")

    if(elem) elem.remove();
  });
  peer.on("error", (err) => {
    console.error(err);
  });

  // run when someone calls us. answer the call
  peer.on("call", async (call) => {
    console.log("call from", call.peer);

    call.answer(await getAudioStream());
    receiveCall(call);
  });
}


function mute(id) {
  console.log(id);
  const player = players.find((p) => p.id === id.toString());
  if (!player) return console.error("no player, no mute");

  var muteToggleBtn = document.querySelector(
    "div[profileId='" + id + "'] > button[id='muteBtn']"
  )

  if (player.stream) {
    if (muteToggleBtn.innerHTML == "Unmute") {
      player.stream.stream.getAudioTracks()[0].enabled = true;
      console.log("unmuted");
      player.muted = false;
      document.querySelector(
        "div[profileId='" + id + "'] > button[id='muteBtn']"
      ).innerHTML = "Mute";
    } else {
      player.stream.stream.getAudioTracks()[0].enabled = false;
      console.log("muted");
      player.muted = true;
    }
  }
}

function toggleMuteAll() {
  if(mutedAll == false) {
    mutedAll = true;
    document.querySelector("#muteAllBtn").innerHTML = "Unmute All";
    players.forEach((p) => {
      if(p.stream) {
        p.stream.stream.getAudioTracks()[0].enabled = false;

        document.querySelector(
          "div[profileId='" + p.id + "'] > button[id='muteBtn']"
        ).innerHTML = "Unmute";
      }
    })
  } else {
    mutedAll = false;
    document.querySelector("#muteAllBtn").innerHTML = "Mute All";
    players.forEach((p) => {
      if(p.stream) {
        p.stream.stream.getAudioTracks()[0].enabled = true;

        document.querySelector(
          "div[profileId='" + p.id + "'] > button[id='muteBtn']"
        ).innerHTML = "Mute";
      }
    })  
  }
}

socket.on("error", (err) => {
  console.error(err);

  const errorToast = document.getElementById("errorToast");
  const errorText = document.getElementById("errorText");
  errorText.innerText = err;
  const toast = new bootstrap.Toast(errorToast);
  toast.show();
});

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
      console.log("created stream for", call.peer);
    }
    // playAudioStream(stream, call.peer);
  });
}

setInterval(function () {
  for (const p of players) {
    if (p.stream) {
      console.log(p.id, "is", calcVolumes(myPos, p.pos));
      const [left, right] = calcVolumes(myPos, p.pos);
      p.stream.setVolume(left, right);
    }
  }
}, 100);

// setup peer when user receives id
socket.on("id", async (connId) => {
  // this only happens if we lose connection with the server
  if (id) {
    console.log("destroying old identity", id, "and replacing with", connId);
    peer.destroy();
    peer = undefined;
    return;
  }

  id = connId;
  initPeer();
});

// talk to any user who joins
socket.on("join", (target, pos, username) => {
  console.log("calling", target);
  players.push({
    id: target,
    avatar: 0,
    pos,
    goal: { x: pos.x, y: pos.y },
    username,
  });

  var profileDiv = document.createElement("div");
  profileDiv.className = "text-center mx-auto my-1";
  profileDiv.setAttribute("profileId", target);
  profileDiv.innerHTML = `<label class="mx-1">${username}</label><button class="btn btn-danger mx-1" id="muteBtn" onclick="mute(${target});">Mute</button><button class="btn btn-info"><a href="https://www.brick-hill.com/user/${target}" target="_blank">Profile</a></button>`;

  startCall(target);
});

socket.on("players", (existingPlayers) => {
  for (const p of existingPlayers) {
    players.push({
      username: p.username,
      id: p.id,
      avatar: 0,
      pos: p.pos,
      goal: { x: p.pos.x, y: p.pos.y },
    });

    var profileDiv = document.createElement("div");
    profileDiv.className = "text-center mx-auto my-1";
    profileDiv.setAttribute("profileId", p.id);
    profileDiv.innerHTML = `<label class="mx-1">${p.username}</label><button class="btn btn-danger mx-1" id="muteBtn" onclick="mute(${p.id});">Mute</button><button class="btn btn-info"><a href="https://www.brick-hill.com/user/${p.id}" target="_blank">Profile</a></button>`;

    document.getElementById("playersContainer").appendChild(profileDiv);
  }
});

socket.on("myPos", (pos) => {
  myPos = pos;
});

socket.on("mute", (userid) => {
  const player = players.find((p) => p.id === userid);
  if (!player) return console.error("no player, no mute");

  var muteToggleBtn = document.querySelector(
    "div[profileId='" + userid + "'] > button[id='muteBtn']"
  )

  if (player.stream) {
      muteToggleBtn.innerHTML = "Unmute";
      player.stream.stream.getAudioTracks()[0].enabled = false;
      console.log("muted");
      player.muted = true;
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
  console.log("call dropped from", target);
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


function filterPlayers() {
  const filterInpt = document.getElementById("filterInpt");
  const playersContainer = document.getElementById("playersContainer");
  const players = playersContainer.getElementsByTagName("div");
  for (const p of players) {
    if (p.innerText.toLowerCase().includes(filterInpt.value.toLowerCase())) {
      p.style.display = "block";
    } else {
      p.style.display = "none";
    }
  }
}

document.getElementById("filterInpt").addEventListener("input", filterPlayers);
