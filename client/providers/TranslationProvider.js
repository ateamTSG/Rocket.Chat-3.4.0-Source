import React, { useMemo, useCallback } from 'react';
import { TAPi18n, TAPi18next } from 'meteor/rocketchat:tap-i18n';

import { TranslationContext } from '../contexts/TranslationContext';
import { useReactiveValue } from '../hooks/useReactiveValue';

const createTranslateFunction = (language) => {
	const translate = (key, ...replaces) => {
		if (typeof replaces[0] === 'object') {
			const [options, lang_tag = language] = replaces;
			return TAPi18next.t(key, {
				ns: 'project',
				lng: lang_tag,
				...options,
			});
		}

		if (replaces.length === 0) {
			return TAPi18next.t(key, { ns: 'project', lng: language });
		}

		return TAPi18next.t(key, {
			postProcess: 'sprintf',
			sprintf: replaces,
			ns: 'project',
			lng: language,
		});
	};

	translate.has = (key, { lng = language, ...options } = {}) =>
		!!key && TAPi18next.exists(key, { ns: 'project', lng, ...options });

	return translate;
};

export function TranslationProvider({ children }) {
	const languages = useReactiveValue(() => {
		const result = Object.entries(TAPi18n.getLanguages())
			.map(([key, language]) => ({ ...language, key: key.toLowerCase() }))
			.sort((a, b) => a.key - b.key);

		result.unshift({
			name: 'Default',
			en: 'Default',
			key: '',
		});

		return result;
	}, []);
	const language = useReactiveValue(() => TAPi18n.getLanguage());
	const loadLanguage = useCallback((language) => TAPi18n._loadLanguage(language), []);
	const translate = useMemo(() => createTranslateFunction(language), [language]);

	return <TranslationContext.Provider
		children={children}
		value={{
			languages,
			language,
			loadLanguage,
			translate,
		}}
	/>;
}
