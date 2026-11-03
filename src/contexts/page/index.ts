import "@/common/messaging/contexts/window";

import {
  MapgenieAdBlocker,
  getPageType,
  getAuthToken,
  type PageType,
} from "@/common/mapgenie";

import pageService from "@/services/page.service";
import extensionService from "@/services/extension.service";
import backendService from "@/services/backend.service";
import { waitForPageAccount } from "@/common/mapgenie/account";

import { HomePage } from "./pages/home";
import { GameHomePage } from "./pages/game-home";
import { MapPage } from "./pages/map";
import { GuidePage } from "./pages/guide";
import { LoginPage } from "./pages/login";

const FMG = Symbol.for("FMG");

declare global {
  interface Window {
    [FMG]?: boolean;
  }
}

const getPageScript = async (pageType: PageType) => {
  switch (pageType) {
    case "home":
      return new HomePage();
    case "game-home":
      return new GameHomePage();
    case "map":
      return new MapPage();
    case "guide":
      return new GuidePage();
    case "login":
      return new LoginPage();
    default:
      return null;
  }
};

const checkReload = () => {
  if (FMG in window) {
    window.location.reload();
  } else {
    window[FMG] = true;
  }
};

const fetchAccountName = async (id: number) => {
  const cacheKey = `fmg:account-name:${id}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return cached;

    let href: string | undefined;
    for (let i = 0; i < 40 && !href; i++) {
      href = document.querySelector<HTMLAnchorElement>('a[href$="/account"]')
        ?.href;
      if (!href) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!href) return undefined;

    const res = await fetch(href, { credentials: "same-origin" });
    if (!res.ok) return undefined;

    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const name = doc.querySelector(".account-profile-name")?.textContent?.trim();
    if (name) localStorage.setItem(cacheKey, name);
    return name || undefined;
  } catch {
    return undefined;
  }
};

const initializeBackendUserState = async (
  backend: backendService.Instance
) => {
  try {
    // Set auth token in backend service
    const auth = getAuthToken();
    await backend.setAuthToken(auth);
    const account = await waitForPageAccount();
    await backend.updateUser(account);
    if (account && !account.name) {
      // Name lookup is optional and must not delay the profile or map boot.
      void fetchAccountName(account.id).then(async (name) => {
        if (name) await backend.updateAccountName(account.id, name);
      }).catch((err) => logger.debug("Could not read account name.", err));
    }
  } catch (err) {
    logger.debug(
      "Could not refresh MapGenie account profile; continuing with local FMG data.",
      err
    );
  }
};

export default defineUnlistedScript(async () => {
  const extension = extensionService.use();
  let failed: boolean = false;
  let pageType: PageType = "unknown";
  let pageScript: Awaited<ReturnType<typeof getPageScript>> = null;

  try {
    const backend = backendService.use();

    pageType = await getPageType();
    pageScript = await getPageScript(pageType);

    if (!pageScript) return;

    // Resolve the real account before MapPage substitutes the local profile ID.
    const accountReady = initializeBackendUserState(backend);
    if (pageType === "map") await accountReady;

    // Reload if script was already injected
    checkReload();

    logger.log(`Initializing page ${pageType} script.`);

    MapgenieAdBlocker.start();
    MapgenieAdBlocker.removePrivacyPopup();

    await pageScript.start();

    logger.log(`Page ${pageType} script initialized.`);
  } catch (err) {
    failed = true;

    logger.error(`Page ${pageType} script failed to initialize.`, err);
  } finally {
    await extension.unmountLoadingOverlay();
  }

  if (pageScript) {
    pageService.provide({ failed, page: pageScript });
  }
});
