let sLocked = false;
var allowed = [3, 200737]; // permenent allowed users
var admins = [1, 102255];

Game.on("playerJoin", (player) => {
  if (sLocked == true) {
    if (!allowed.includes(player.userId) && !admins.includes(player.userId))
      return player.kick(
        "This server is currently sLocked! Please try again later."
      );
  }
});

Game.command("slock", (caller, args) => {
  if (!admins.includes(caller.userId)) return;
  if (sLocked == true) {
    sLocked = false;
    caller.message("Disabled sLock on server.");
  } else if (sLocked == false) {
    sLocked = true;
    caller.message("Enabled sLock on server.");
  }
});
