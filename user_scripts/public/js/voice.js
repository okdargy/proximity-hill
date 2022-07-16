const $ = document.querySelector.bind(document);
const SOUND_CUTOFF_RANGE = 50;
const SOUND_NEAR_RANGE = 5;

// Get cookie of user
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(";").shift();
}

if(!getCookie("token")) window.location.href = "/"

// Establish socket connection
const socket = io({
  auth: {
    token: getCookie("token"),
  },
});

var localPosition = { x: 0, y: 0 }; // Last known position of the user
var players = []; // All players/sockets that are connected
var elems = []; // All elements which show media tools for a player

function error(message) {
  const errorToast = document.getElementById("errorToast");
  const errorText = document.getElementById("errorText");

  errorText.innerText = message;
  const toast = new bootstrap.Toast(errorToast);
  toast.show();
}

function info(message) {
  const infoToast = document.getElementById("infoToast");
  const infoText = document.getElementById("infoText");

  infoText.innerText = message;
  const toast = new bootstrap.Toast(infoToast);
  toast.show();
}

/*
The proximity would be possible without Meshiest's open source code.
Please check out Meshiest's repository: https://github.com/Meshiest/demo-proximity-voice
Check out Meshiest: https://github.com/Meshiest
*/

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

function initPeer() {
  peer = new Peer(id, {
    host: location.hostname,
    port: location.port,
    path: "/peerjs",
  });

  peer.on("disconnected", (id) => {
    error("You have been disconnected.")

    document.querySelector('#playersContainer').innerHTML = ""
    document.querySelectorAll('video').forEach(video => video.remove())
  });

  // Error handling
  peer.on("error", (err) => {
    error(err);
  });

  // run when someone calls us. answer the call
  peer.on("call", async (call) => {
    console.log("Recieving call from:", call.peer);

    call.answer(await getAudioStream());
    receiveCall(call);
  });
}

let pContainer = document.querySelector('#playersContainer');
let pTemplate = document.querySelector('#playerTemplate');

function createNewPlayer(username, id) {
  let clonedTemplate = pTemplate.content.cloneNode(true).querySelector("div")
  clonedTemplate.setAttribute("profileId", id)

  clonedTemplate.querySelector('#playerLabel').textContent = username
  clonedTemplate.querySelector('#muteBtn').setAttribute("onclick", `mutePlayer("${id}")`)
  clonedTemplate.querySelector('#profileLink').setAttribute("href", `https://www.brick-hill.com/user/${id}`)

  elems.push(clonedTemplate);
  pContainer.append(clonedTemplate);
}

async function startCall(target) {
  if (!peer) return;
  const call = peer.call(target, await getAudioStream());

  receiveCall(call);
}

// play the stream from the call in a video element
function receiveCall(call) {
  call.on("stream", (stream) => {
    console.log('Receiving stream from:', call.peer);
    console.log(players)
    const player = players.find((p) => p.id === call.peer);
    if (!player) {
      error("Couldn't find player for stream: " + call.peer);
    } else {
      player.stream = new StreamSplit(stream, { left: 1, right: 1 });
      playAudioStream(stream, call.peer);
      console.log("Successfully created stream for: ", call.peer);
      info(player.username + " has joined the voice channel.")

      createNewPlayer(player.username, player.id)
    }
  });
}

socket.on("error", (err) => {
  error(err);
  console.error("Socket error:", err);
});

let id, peer;

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

socket.on("players", (existingPlayers) => {
  for (const p of existingPlayers) {
    players.push({
      username: p.username,
      id: p.id,
      pos: p.pos,
    });
  }
});

socket.on("pos", (id, pos) => {
  if(id == -1) {
    localPosition = pos;
  } else {
    const player = players.find((p) => p.id === id);

    if (player) {
      player.pos = pos;
    }
  }
});


socket.on("leave", (target) => {
  info(players.find((p) => p.id === target).username + " has left the voice channel.");
  const elem = $(`[data-peer="${target}"]`);
  if (elem) elem.remove();

  // remove player from playersContainer div if they leave
  document.querySelectorAll('#playersContainer > #playerContainer').forEach(elem => {
    if (elem.getAttribute('profileId') === target) {
      elem.remove();
    }
  })

  // remove player from players list
  const index = players.findIndex((p) => p.id === target);
  if (index > -1) {
    // close the stream
    if (players[index].stream) players[index].stream.close();
    players.splice(index, 1);
  }
});

setInterval(function() {
  if(!players) return; // quick fix for when there are no players

  for (const p of players) {
    if (p.stream) {
      const [left, right] = calcVolumes(localPosition, p.pos);
      p.stream.setVolume(left, right);
    }
  }
}, 500);

socket.on("join", (target, pos, username) => {
  console.log("calling", target);

  players.push({
    id: target,
    pos,
    username,
  });

  startCall(target);
});

socket.on("mute", (target) => {
  const player = players.find((p) => p.id === target);
  if (!player) return console.error("Couldn't find player for mute: " + target);
  
  var muteToggleBtn = document.querySelector("div[profileId='" + target + "'] > button[id='muteBtn']")
  
  if (muteToggleBtn && muteToggleBtn.innerHTML === "Mute") muteToggleBtn.innerHTML = "Unmute"
  if(player.stream && player.stream.stream.getAudioTracks()[0].enabled == true) player.stream.stream.getAudioTracks()[0].enabled = false;
});

function mutePlayer(id) {
  // toggle mute
  const player = players.find((p) => p.id === id);
  if (!player) return error("Couldn't find player for mute: " + id);

  var muteToggleBtn = document.querySelector("div[profileId='" + id + "'] > button[id='muteBtn']")

  if (muteToggleBtn && muteToggleBtn.innerHTML === "Mute") {
    muteToggleBtn.innerHTML = "Unmute"
    player.muted = true;
    if(player.stream && player.stream.stream.getAudioTracks()[0].enabled == true) player.stream.stream.getAudioTracks()[0].enabled = false;
  } else if(muteToggleBtn && muteToggleBtn.innerHTML === "Unmute") {
    muteToggleBtn.innerHTML = "Mute"
    player.muted = false;
    if(player.stream && player.stream.stream.getAudioTracks()[0].enabled == false) player.stream.stream.getAudioTracks()[0].enabled = true;
  }
}

var muteMicBtn = document.querySelector("button[id='muteMicBtn']")

muteMicBtn.addEventListener("click", function() {
    // mute mic
    if (muteMicBtn.innerHTML == "Mute") {
      getAudioStream().then(stream => {
        stream.getAudioTracks()[0].enabled = false;
        muteMicBtn.innerHTML = "Unmute";
      })
      info("Mic muting is an expiremental feature. Please do not rely on it to mute your microphone.")
    } else if (muteMicBtn.innerHTML ==  "Unmute") {
      getAudioStream().then(stream => {
        stream.getAudioTracks()[0].enabled = true;
        muteMicBtn.innerHTML = "Mute";
      })
      info("Mic muting is an expiremental feature. Please do not rely on it to mute your microphone.")
    }
})

var deafenBtn = document.querySelector("button[id='deafenBtn']")

deafenBtn.addEventListener("click", function() {
  console.log("Deafening all players..")
  if(deafenBtn.innerHTML == "Deafen") {
    players.forEach(player => {
      var muteToggleBtn = document.querySelector("div[profileId='" + player.id + "'] > button[id='muteBtn']")
    
      if(muteToggleBtn) muteToggleBtn.innerHTML = "Unmute"
      if(player.stream && player.stream.stream.getAudioTracks()[0].enabled == true) player.stream.stream.getAudioTracks()[0].enabled = false;
    })

    deafenBtn.innerHTML = "Undeafen"
  } else if(deafenBtn.innerHTML == "Undeafen") {
    players.forEach(player => {
      if(player.muted) return
      var muteToggleBtn = document.querySelector("div[profileId='" + player.id + "'] > button[id='muteBtn']")
    
      if(muteToggleBtn) muteToggleBtn.innerHTML = "Mute"
      if(player.stream && player.stream.stream.getAudioTracks()[0].enabled == false) player.stream.stream.getAudioTracks()[0].enabled = true;
    })

    deafenBtn.innerHTML = "Deafen"
  }
})
