import { en } from "./en";

export type Locale = "en" | "ja";

/** Widen the literal English strings so other locales can reuse the exact key shape. */
export type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Widen<U>[]
    : { [K in keyof T]: Widen<T[K]> };

export type Messages = Widen<typeof en>;
