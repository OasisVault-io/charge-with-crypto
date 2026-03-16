import baseConfig from '@epic-web/config/prettier'

/** @type {import('prettier').Config} */
export default {
	...baseConfig,
	overrides: [
		...(baseConfig.overrides ?? []),
		{
			files: ['**/*.tsx'],
			options: {
				useTabs: false,
			},
		},
	],
}
