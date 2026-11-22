package main

// fontLibrary lists fonts that WA sheets use, hosted by WA or Google. The Fonts section
// offers them with one click; only the fonts picked go into approved.css.
// All links were checked to answer with Access-Control-Allow-Origin: *, so the editor
// canvas can load them as well.
var fontLibrary = []Font{
	{Name: "Alegreya Regular", URL: "https://worldanvil-static.sfo2.cdn.digitaloceanspaces.com/fonts/Alegreya-Regular.otf"},
	{Name: "Amarante", URL: "https://worldanvil-static.sfo2.cdn.digitaloceanspaces.com/fonts/Amarante-Regular.ttf"},
	{Name: "BlackOpsOne Regular", URL: "https://worldanvil-static.sfo2.cdn.digitaloceanspaces.com/fonts/BlackOpsOne-Regular.ttf"},
	{Name: "Eczar Bold", URL: "https://worldanvil-static.sfo2.cdn.digitaloceanspaces.com/fonts/Eczar-Bold.ttf"},
	{Name: "Grenze", URL: "https://fonts.gstatic.com/s/grenze/v1/O4ZTFGb7hR12BxqH-GIm.woff2"},
	{Name: "IM Fell Double Pica Roman", URL: "https://worldanvil-static.sfo2.cdn.digitaloceanspaces.com/fonts/IMFellDoublePica-Regular.ttf"},
	{Name: "IM Fell English SC", URL: "https://fonts.gstatic.com/s/imfellenglishsc/v9/a8IENpD3CDX-4zrWfr1VY879qFF05pZ7PIIP.woff2"},
	{Name: "IM Fell Great Primer SC", URL: "https://fonts.gstatic.com/s/imfellgreatprimersc/v6/A313vRj97hMMGFjt6rgSJtRg-ciw1Y27JeXb2Zv4lZQ.ttf"},
	{Name: "Orbitron", URL: "https://worldanvil-static.sfo2.cdn.digitaloceanspaces.com/fonts/orbitron-bold.otf"},
	{Name: "PT Sans Narrow", URL: "https://worldanvil-static.sfo2.cdn.digitaloceanspaces.com/fonts/PTSansNarrow-Regular.ttf"},
	{Name: "Skranji", URL: "https://worldanvil-static.sfo2.cdn.digitaloceanspaces.com/fonts/Skranji-Regular.ttf"},
	{Name: "Teko Regular", URL: "https://worldanvil-static.sfo2.cdn.digitaloceanspaces.com/fonts/Teko-Regular.ttf"},
}
