document.getElementById("code").placeholder = Math.floor(
  100000 + Math.random() * 900000
);

function setErrorMessage(value) {
  var error = document.getElementById("error");
  error.innerHTML =
    '<p id="error" class="mt-2 text-center text-danger">' + value + "</p>";
}

function clearErrorMessage() {
  var error = document.getElementById("error");
  error.innerHTML = '<p id="error"></p>';
}

document.getElementById("next").addEventListener("click", async function () {
  clearErrorMessage();
  var code = document.getElementById("code");
  if (code.value.length !== 6) return setErrorMessage("Code must be 6 digits.");

  var myHeaders = new Headers();
  myHeaders.append("Content-Type", "application/json");

  var requestOptions = {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({
      userid: localStorage.getItem("userId"),
      code: document.getElementById("code").value,
    }),
  };

  fetch("/auth", requestOptions)
    .then((response) => response.json())
    .then((data) => {
      if (data.error) return setErrorMessage(data.error);

      if (data.token) {
        document.cookie = `token=${data.token}`;
        document.location.href = "/whoami";
      }
    })
    .catch((error) => console.log("error", error));
});
