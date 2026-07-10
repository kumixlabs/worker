import { CheckIcon, LanguagesIcon } from "lucide-react";
import { useTranslations } from "use-intl";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@kumix/ui";
import { type Locale, useLocale } from "@/hooks/use-locale";

const locales: {
  value: Locale;
  label: string;
}[] = [
  {
    value: "en",
    label: "English",
  },
  {
    value: "id",
    label: "Indonesia",
  },
];

export function LocaleSwitcher() {
  const t = useTranslations("Shell");
  const { locale, setLocale } = useLocale();

  const isActive = (val: Locale) => locale === val;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <LanguagesIcon />
          <span className="sr-only">{t("language")}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
        {locales.map((item) => (
          <DropdownMenuItem
            key={item.value}
            className={isActive(item.value) ? "bg-accent" : ""}
            onClick={() => setLocale(item.value)}
          >
            <div className="flex w-full items-center justify-between">
              <span>{item.label}</span>
              {isActive(item.value) && <CheckIcon className="size-4" />}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
