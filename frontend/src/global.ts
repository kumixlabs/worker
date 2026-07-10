import "use-intl";

import type { LOCALES } from "@/hooks/use-locale";
import type messages from "../messages/en.json";

declare module "use-intl" {
  interface AppConfig {
    Locale: (typeof LOCALES)[number];
    Messages: typeof messages;
  }
}
