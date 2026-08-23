import { expect, mock, test } from "bun:test";

import { registerFieldSecurityBackgroundLock } from "./FieldSecuritySessionProvider";

test("locks on every pagehide and hidden visibility transition", () => {
  const windowTarget = new EventTarget();
  const documentTarget = new EventTarget();
  const lock = mock(() => undefined);
  let visibilityState: DocumentVisibilityState = "visible";
  const release = registerFieldSecurityBackgroundLock({
    documentTarget,
    getVisibilityState: () => visibilityState,
    lock,
    windowTarget,
  });

  windowTarget.dispatchEvent(new Event("pagehide"));
  visibilityState = "hidden";
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  visibilityState = "visible";
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  visibilityState = "hidden";
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  windowTarget.dispatchEvent(new Event("pagehide"));

  expect(lock).toHaveBeenCalledTimes(4);
  expect(lock).toHaveBeenNthCalledWith(1, "manual");
  expect(lock).toHaveBeenNthCalledWith(4, "manual");

  release();
  windowTarget.dispatchEvent(new Event("pagehide"));
  visibilityState = "hidden";
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  expect(lock).toHaveBeenCalledTimes(4);
});
