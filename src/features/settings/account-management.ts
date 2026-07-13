type AccountManagementSurfaceProps = {
  getContainer?: () => HTMLElement | null;
};

type AccountManagementObserver = {
  disconnect: () => void;
  observe: (target: HTMLElement, options: MutationObserverInit) => void;
};

type AccountManagementAdapterOptions = {
  createObserver?: (callback: () => void) => AccountManagementObserver;
  focusTrigger: () => void;
  getOrCreateContainer?: () => HTMLElement | null;
  openAccountManagement: (props?: AccountManagementSurfaceProps) => void;
};

const accountManagementRootId = "ask-siargao-account-management-root";

function getOrCreateAccountManagementRoot() {
  if (typeof document === "undefined") {
    return null;
  }

  const existingRoot = document.getElementById(accountManagementRootId);
  if (existingRoot) {
    return existingRoot;
  }

  const root = document.createElement("div");
  root.id = accountManagementRootId;
  document.body.append(root);
  return root;
}

function createMutationObserver(callback: () => void) {
  return new MutationObserver(callback);
}

export function createAccountManagementAdapter({
  createObserver = createMutationObserver,
  focusTrigger,
  getOrCreateContainer = getOrCreateAccountManagementRoot,
  openAccountManagement,
}: AccountManagementAdapterOptions) {
  let observer: AccountManagementObserver | null = null;
  let hasSeenManagedSurface = false;

  function stopWatching() {
    observer?.disconnect();
    observer = null;
    hasSeenManagedSurface = false;
  }

  function watchContainer(container: HTMLElement) {
    stopWatching();

    const syncManagedSurfaceState = () => {
      if (container.childElementCount > 0) {
        hasSeenManagedSurface = true;
        return;
      }

      if (!hasSeenManagedSurface) {
        return;
      }

      stopWatching();
      focusTrigger();
    };

    observer = createObserver(syncManagedSurfaceState);
    observer.observe(container, { childList: true });
    syncManagedSurfaceState();
  }

  return {
    open() {
      const container = getOrCreateContainer();
      if (!container) {
        openAccountManagement();
        return;
      }

      watchContainer(container);

      try {
        openAccountManagement({ getContainer: () => container });
      } catch (error) {
        stopWatching();
        throw error;
      }
    },
    stopWatching,
  };
}
