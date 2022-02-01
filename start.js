const nh = require("node-hill");
const dotenv = require("dotenv").config();

nh.startServer({
  hostKey: "", // Your host key here (can be found under the settings of the set.)

  gameId: 478, // Your game id here

  port: 42480, // Your port id here (default is 42480)

  local: true, // Whether or not your server is local

  mapDirectory: "./maps/", // The path to your maps folder.

  map: "example.brk", // The file name of your .brk

  scripts: "./user_scripts", // Your .js files path

  // Add npm / built-in node.js modules here
  modules: [
    "express",
    "jsonwebtoken",
    "quick.db",
    "node-fetch",
    { config: process.env }, // replacing dotenv
    "body-parser",
    "cookie-parser",
    "socket.io",
    "peer",
    "uuid",
    "http",
  ],
});

// For more help: https://brickhill.gitlab.io/open-source/node-hill/interfaces/gamesettings.html
