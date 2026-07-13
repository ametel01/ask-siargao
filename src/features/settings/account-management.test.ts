import { describe, expect, test } from "bun:test";

import { createAccountManagementAdapter } from "@/features/settings/account-management";

function fakeContainer() {
  let childCount = 0;

  return {
    container: {
      get childElementCount() {
        return childCount;
      },
    } as HTMLElement,
    setChildCount(nextChildCount: number) {
      childCount = nextChildCount;
    },
  };
}

describe("createAccountManagementAdapter", () => {
  test("opens the configured account management surface in an app-owned container", () => {
    const { container } = fakeContainer();
    const observeCalls: HTMLElement[] = [];
    let openedContainer: HTMLElement | null | undefined;

    const accountManagement = createAccountManagementAdapter({
      createObserver: () => ({
        disconnect: () => {},
        observe: (target) => {
          observeCalls.push(target);
        },
      }),
      focusTrigger: () => {
        throw new Error("focus should not return before the managed surface closes");
      },
      getOrCreateContainer: () => container,
      openAccountManagement: (props) => {
        openedContainer = props?.getContainer?.();
      },
    });

    accountManagement.open();

    expect(openedContainer).toBe(container);
    expect(observeCalls).toEqual([container]);
  });

  test("returns focus after the provider-managed surface closes", () => {
    const { container, setChildCount } = fakeContainer();
    let mutationCallback: (() => void) | undefined;
    let disconnectCalls = 0;
    let focusCalls = 0;

    const accountManagement = createAccountManagementAdapter({
      createObserver: (callback) => {
        mutationCallback = callback;
        return {
          disconnect: () => {
            disconnectCalls += 1;
          },
          observe: () => {},
        };
      },
      focusTrigger: () => {
        focusCalls += 1;
      },
      getOrCreateContainer: () => container,
      openAccountManagement: () => {},
    });

    accountManagement.open();
    expect(focusCalls).toBe(0);

    setChildCount(1);
    mutationCallback?.();
    expect(focusCalls).toBe(0);

    setChildCount(0);
    mutationCallback?.();
    expect(focusCalls).toBe(1);
    expect(disconnectCalls).toBe(1);

    mutationCallback?.();
    expect(focusCalls).toBe(1);
  });

  test("does not move focus when the provider surface never mounts", () => {
    const { container } = fakeContainer();
    let mutationCallback: (() => void) | undefined;
    let focusCalls = 0;

    const accountManagement = createAccountManagementAdapter({
      createObserver: (callback) => {
        mutationCallback = callback;
        return {
          disconnect: () => {},
          observe: () => {},
        };
      },
      focusTrigger: () => {
        focusCalls += 1;
      },
      getOrCreateContainer: () => container,
      openAccountManagement: () => {},
    });

    accountManagement.open();
    mutationCallback?.();

    expect(focusCalls).toBe(0);
  });

  test("cleans up the close watcher when opening fails", () => {
    const { container } = fakeContainer();
    let disconnectCalls = 0;

    const accountManagement = createAccountManagementAdapter({
      createObserver: () => ({
        disconnect: () => {
          disconnectCalls += 1;
        },
        observe: () => {},
      }),
      focusTrigger: () => {},
      getOrCreateContainer: () => container,
      openAccountManagement: () => {
        throw new Error("provider unavailable");
      },
    });

    expect(() => accountManagement.open()).toThrow("provider unavailable");
    expect(disconnectCalls).toBe(1);
  });
});
