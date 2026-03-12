import "./editor";
import { morph } from "morphlex";
import { assert } from "./utils";

/**
 * A stable ID that identifies this client across connections.
 */
let clientId = localStorage.getItem("client-id") ?? crypto.randomUUID();

localStorage.setItem("client-id", clientId);

let websocket = new WebSocket(`?client=${clientId}`);

websocket.onmessage = (message) => {
  let container = document.getElementById("container")!;

  morph(container, `<div id="container">${message.data}</div>`, {
    preserveChanges: true,
    beforeNodeVisited(fromNode, toNode) {
      if (
        fromNode instanceof HTMLElement &&
        fromNode.hasAttribute("data-skip-morph")
      ) {
        return false;
      }

      return true;
    },
  });
};

window.addEventListener("submit", (event) => {
  event.preventDefault();

  if (event.submitter?.hasAttribute("data-event")) {
    return;
  }

  let formData = new FormData(event.target as HTMLFormElement);
  let message = Object.fromEntries(formData.entries());
  websocket.send(JSON.stringify(message));
});

window.addEventListener("change", (event) => {
  assert(event.target instanceof HTMLElement);

  let form = event.target.closest("form");

  if (form?.getAttribute("data-submit") === "change") {
    form.requestSubmit();
  }

  tryToFireEvent(event.target);
});

window.addEventListener("click", (event) => {
  assert(event.target instanceof HTMLElement);
  let button = event.target.closest("[data-event]") as HTMLElement;
  if (button) tryToFireEvent(button);
});

function tryToFireEvent(element: HTMLElement) {
  let type = element.dataset.event;

  if (type) {
    let detail = { ...element.dataset };
    if (element instanceof HTMLInputElement) {
      detail.value = element.value;
    }
    let event = new CustomEvent(type, { detail });
    window.dispatchEvent(event);
  }
}
