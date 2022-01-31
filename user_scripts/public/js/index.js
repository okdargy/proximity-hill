var VALID_USERNAME = RegExp(/^[a-zA-Z0-9\-.\_ ]{1,26}$/);

function setErrorMessage(value) {
  var error = document.getElementById("error");
  error.innerHTML =
    '<p id="error" class="mt-2 text-center text-danger">' + value + "</p>";
}

function clearErrorMessage() {
  var error = document.getElementById("error");
  error.innerHTML = '<p id="error"></p>';
}

document
  .getElementById("un-button")
  .addEventListener("click", async function () {
    clearErrorMessage();

    var username = document.getElementById("username-inp");
    if (!VALID_USERNAME.test(username.value))
      return setErrorMessage(
        "Username must be 3-26 alphanumeric characters (including [ , ., -, _])."
      );
    var myHeaders = new Headers();
    myHeaders.append("Content-Type", "application/json");

    var raw = JSON.stringify({
      username: username.value,
    });

    var requestOptions = {
      method: "POST",
      headers: myHeaders,
      body: raw,
      redirect: "follow",
    };

    await fetch("/exist", requestOptions)
      .then((response) => response.json())
      .then((data) => {
        if (data.error) return setErrorMessage(data.error);
        localStorage.setItem("userId", data.id);
        localStorage.setItem("username", username.value);
        document.location.href = "/verify";
      })
      .catch((error) => console.log("error", error));
  });
