import en from './locales/en.json';
import tr from './locales/tr.json';
import type { Locale } from './i18n';

/** UI translation resources per Locale (nested i18next JSON, shared by web and Expo). */
export const uiResources: Readonly<Record<Locale, typeof en>> = { en, tr };
export type UiResources = typeof uiResources;
