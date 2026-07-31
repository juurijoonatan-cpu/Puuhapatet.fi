import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  // Alkuarvo luetaan SYNKRONISESTI. Aiemmin tämä oli `undefined` → `!!undefined`
  // = false, joten jokainen puhelin ja iPad piirsi ensin työpöytäasettelun ja
  // hyppäsi sitten mobiiliin. FR8-dashissa se tarkoitti ~20 kohtaa (paddingit,
  // 4 gridiä, 6 fonttikokoa) jotka kaikki liikkuivat ensimmäisen framen jälkeen.
  const [isMobile, setIsMobile] = React.useState<boolean>(
    () => typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT,
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
