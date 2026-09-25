export type VoiceLike = { name: string; lang: string }

const MALE = /\b(guy|christopher|eric|andrew|brian|roger|steffan|david|mark|daniel|george|arthur|male)\b/i
const FEMALE = /\b(zira|aria|jenny|michelle|ana|sonia|libby|female)\b/i

/** Picks the voice to speak with: the remembered one if present, else the closest thing to KITT's register the browser offers. */
export function pickVoice<T extends VoiceLike>(voices: T[], remembered: string | null): T | null {
  if (remembered) {
    const hit = voices.find((v) => v.name === remembered)
    if (hit) return hit
  }
  const us = voices.filter((v) => /^en[-_]US/i.test(v.lang))
  const en = voices.filter((v) => /^en/i.test(v.lang))
  const male = (list: T[]) => list.filter((v) => MALE.test(v.name) && !FEMALE.test(v.name))
  return (
    male(us).find((v) => /natural|neural|online/i.test(v.name)) ??
    male(us)[0] ??
    male(en).find((v) => /natural|neural|online/i.test(v.name)) ??
    male(en)[0] ??
    us[0] ??
    en[0] ??
    voices[0] ??
    null
  )
}
