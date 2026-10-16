// Camera bubble contents. Lives in an extension iframe so the camera permission
// belongs to Tape, not to whatever site the bubble sits on.
const video = document.querySelector("video");
const note = document.querySelector("p");
const device = new URLSearchParams(location.search).get("device");
const v = { width: { ideal: 640 }, height: { ideal: 640 }, frameRate: { ideal: 30 } };

async function open() {
  try {
    return await navigator.mediaDevices.getUserMedia({ video: device ? { ...v, deviceId: { exact: device } } : v });
  } catch (e) {
    if (device) return navigator.mediaDevices.getUserMedia({ video: v });
    throw e;
  }
}

open()
  .then((stream) => {
    video.srcObject = stream;
    video.onplaying = () => video.classList.add("on");
    addEventListener("pagehide", () => stream.getTracks().forEach((t) => t.stop()));
  })
  .catch((e) => {
    note.textContent = e.name === "NotAllowedError" ? "Camera blocked on this site" : "Camera unavailable";
    note.hidden = false;
  });
