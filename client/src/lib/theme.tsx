import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    // localStorage HEITTÄÄ Safarin privaattitilassa ja joissakin in-app
    // selaimissa (linkki avattuna Instagramista/WhatsAppista). Tämä ajetaan
    // ensimmäisen renderin aikana koko sovelluksen juuressa, joten käsittelemätön
    // poikkeus kaatoi KAIKEN valkoiseksi virhesivuksi. Teema on mukavuusasetus —
    // sen puuttuminen ei saa estää sovelluksen käyttöä.
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("puuhapatet-theme");
        if (stored === "light" || stored === "dark") return stored;
      } catch { /* privaattitila — jatketaan järjestelmän asetuksella */ }
      try {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      } catch { return "light"; }
    }
    return "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    try { localStorage.setItem("puuhapatet-theme", theme); } catch { /* ks. yllä */ }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
