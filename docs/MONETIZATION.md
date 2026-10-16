# Monetization: support button, custom domain, ads

Status (16 Oct 2026): everything is prepared in code and **off**. Nothing changes on the live site until the switches in `site/config.js` are set. Every account, purchase and setting below has to be done by the owner.

| Piece | In the repo | Switch |
|---|---|---|
| Sponsor button on the GitHub repo page | `.github/FUNDING.yml` (`github: [FernandoVazq]`) | Appears once Sponsors is approved |
| "Support" link in the site header and on the Method page | `site/support.js` | `sponsorsUrl` in `site/config.js` |
| Privacy policy (AdSense-ready) | `site/privacy.html`, linked from the Method page footer and the ad box | Always on |
| One ad unit, side panel below the route, never over the map | `site/ads.js`, `#adSlot` in `site/index.html` | `adsense` in `site/config.js` |

## Order of operations

1. GitHub Sponsors (no cost, can start today).
2. Domain (about $11/yr), then point it at GitHub Pages.
3. AdSense, only after the domain works over HTTPS and only if traffic justifies it (see the revenue table: under ~10k pageviews a month it is a few dollars).

### 1. GitHub Sponsors

1. Turn on two-factor authentication on the GitHub account (required).
2. Go to <https://github.com/sponsors>, click **Get sponsored**, choose the personal account `FernandoVazq`, fill in contact details and pick the payout method: **bank account via Stripe Connect** (the payout method can only be chosen at sign-up).
3. In the Sponsors dashboard: **Profile details** (short bio, why the project matters; feature the `mach-corridor` repo), then **Sponsor tiers** (e.g. $3, $10 monthly and a one-time tier; published tier prices cannot be edited later).
4. **Stripe Connect account**: identity and bank details. Residence and bank must be in the same supported country. Check them before submitting; they are hard to change.
5. **Tax forms**: W-9 for a US person (Puerto Rico residents are US persons), W-8BEN otherwise.
6. Click **Request approval**. GitHub reviews in a few days.
7. When the profile is live (<https://github.com/sponsors/FernandoVazq>): the repo's **Sponsor** button appears by itself from `.github/FUNDING.yml`. Then, in `site/config.js`, set
   `sponsorsUrl: "https://github.com/sponsors/FernandoVazq",`
   commit and push. The site shows "Support" next to the Prototype badge and a line on the Method page.

Source: [Setting up GitHub Sponsors for your personal account](https://docs.github.com/en/sponsors/receiving-sponsorships-through-github-sponsors/setting-up-github-sponsors-for-your-personal-account); [About GitHub Sponsors](https://docs.github.com/en/sponsors/getting-started-with-github-sponsors/about-github-sponsors) (0% fee on sponsorships from personal accounts); [Tax information](https://docs.github.com/en/sponsors/receiving-sponsorships-through-github-sponsors/tax-information-for-github-sponsors).

### 2. Custom domain

**Recommended: `machcorridor.com`.** Same name as the project and the repo, `.com` reads as the most credible to airlines and agencies, no hyphen to spell out, and the price stays flat at renewal. Availability was **not verified** (see the shortlist below); check it at the registrar before anything else. If it is taken, take `machcorridor.org` (cheaper first year, but a higher renewal at some registrars) or `machcorridor.app`.

| Domain | Availability | Porkbun reg / renew | Cloudflare reg / renew | Namecheap reg / renew |
|---|---|---|---|---|
| machcorridor.com (pick) | unverified, no site found under it | $11.08 / $11.08 | $10.46 / $10.46 | $11.28 / $18.48 |
| mach-corridor.com | unverified, no site found under it | $11.08 / $11.08 | $10.46 / $10.46 | $11.28 / $18.48 |
| boomlessmap.com | unverified, no site found under it | $11.08 / $11.08 | $10.46 / $10.46 | $11.28 / $18.48 |
| machcorridor.org | unverified, no site found under it | $7.98 / $11.84 | $8.50 / $11.20 (3rd-party listing) | $8.48 / $18.98 |
| machcorridor.app | unverified, no site found under it | $8.75 / $14.93 | $8.20 / $14.20 (3rd-party listing) | not found |
| boomless.app | unverified, no site found under it | $8.75 / $14.93 | $8.20 / $14.20 (3rd-party listing) | not found |

Prices in USD per year, before tax, checked 16 Oct 2026: Porkbun from its [domain pricing page](https://porkbun.com/products/domains) (first-year .org and .app are sale prices); Cloudflare .com from [vpsranking.com](https://vpsranking.com/domain/cloudflare/) (checked 4 Oct 2026), .org and .app from [domainoffer.net](https://domainoffer.net/tld/org/cloudflare) ([.app](https://domainoffer.net/tld/app/cloudflare)); Namecheap from domainoffer.net ([.com](https://domainoffer.net/tld/com/namecheap), [.org](https://domainoffer.net/tld/org/namecheap)), regular prices without promo codes. Cloudflare's own price table and WHOIS/RDAP lookups could not be reached from the build environment, so availability rests only on a web search finding no site at these names; a domain can be registered without a site. Notes: Cloudflare sells at cost but expects the domain to use Cloudflare DNS (works fine with GitHub Pages; keep the records "DNS only", grey cloud). `.app` is HTTPS-only in every browser (HSTS preload), so the site is unreachable until GitHub issues the certificate.

Steps, in this order (GitHub asks you to add the domain on GitHub **before** creating DNS records, so nobody else can claim it):

1. Buy the domain (1 year, auto-renew on, WHOIS privacy on; it is free at all three).
2. Optional but recommended: verify the domain for your account, GitHub **Settings → Pages → Add a domain** (personal settings, not the repo). This adds a TXT record and stops anyone else's repo from using it.
3. Repo **Settings → Pages → Custom domain**: enter `machcorridor.com`, **Save**.
4. At the registrar's DNS, create:

   | Type | Name | Value |
   |---|---|---|
   | A | @ (apex) | 185.199.108.153 |
   | A | @ | 185.199.109.153 |
   | A | @ | 185.199.110.153 |
   | A | @ | 185.199.111.153 |
   | AAAA (optional) | @ | 2606:50c0:8000::153, 2606:50c0:8001::153, 2606:50c0:8002::153, 2606:50c0:8003::153 |
   | CNAME | www | fernandovazq.github.io (no repo name) |

   Delete any registrar parking A/CNAME records on `@` and `www`. IPs checked against [Managing a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) on 16 Oct 2026.
5. Wait for the DNS check in Settings → Pages to turn green (minutes to 24 h), then tick **Enforce HTTPS** ([Securing your site with HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)). `fernandovazq.github.io/mach-corridor/` then redirects to the new domain.
6. Only then, optionally, add `site/CNAME` containing the single line `machcorridor.com`. This site deploys with a GitHub Actions workflow, and for Actions deploys GitHub says the CNAME file is ignored and not required; the setting in step 3 is what counts. The file only documents the domain and helps if the site ever moves to branch publishing.
7. Update the absolute URLs in `site/index.html` (`og:url`, `og:image`) and the README to the new domain.

More: [About custom domains and GitHub Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages).

### 3. Ads (Google AdSense)

GitHub's [Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies) allow ads on a Pages site as long as advertising is not its primary purpose: one unit in the side panel fits that. Do it after the domain, because AdSense works per site and `ads.txt` must sit at the root of the domain; with the site at `fernandovazq.github.io/mach-corridor/` the root is `fernandovazq.github.io/`, which belongs to a different repo. (`github.io` is on the public suffix list, so a github.io subdomain can be added as a site, [AdSense help](https://support.google.com/adsense/answer/12170421).) Requirements: be 18 or older and have a privacy policy ([AdSense eligibility and policies](https://support.google.com/adsense/answer/1348695)); the policy is `site/privacy.html`.

1. Sign up at <https://adsense.google.com> with your Google account; add the site `machcorridor.com`; enter payee and tax details (US tax info for a PR resident).
2. Site verification: copy your publisher id (`ca-pub-` + 16 digits) and set `adsense: "ca-pub-XXXXXXXXXXXXXXXX",` in `site/config.js`. That loads the AdSense script only (no ad box). If AdSense does not detect the injected script, use its **ads.txt** or **meta tag** verification method instead.
3. `ads.txt`: create `site/ads.txt` with the line AdSense shows you, of the form
   `google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0`
   It is served at `https://machcorridor.com/ads.txt`, the domain root, which is where AdSense looks ([ads.txt guide](https://support.google.com/adsense/answer/12171612)).
4. **Privacy & messaging** in AdSense: create a **European regulations** message (Google's own certified CMP), select the site, enter the privacy policy URL `https://machcorridor.com/privacy.html`, publish. A certified TCF CMP is required to serve personalised ads in the EEA and UK (since 16 Jan 2024) and Switzerland (since 31 Jul 2024) ([AdSense CMP requirements](https://support.google.com/adsense/answer/13554020)). The message is delivered by the same AdSense script; no extra code.
5. Request review. Approval usually takes days to a few weeks; thin or new sites are often refused, so wait for real traffic.
6. After approval: in AdSense, **turn Auto ads off** for this site (they can put anchors and pop-ups over the map), create one **Display ad unit** (responsive), copy its slot id, and set
   `adsense: { client: "ca-pub-XXXXXXXXXXXXXXXX", slot: "1234567890" },`
   The ad appears in the side panel below the route, labelled "Advertisement", with a link to the privacy page.

Alternatives with less tracking: [EthicalAds](https://www.ethicalads.io/) wants roughly 50k+ pageviews a month; [Carbon Ads](https://www.carbonads.net/) is by application. Both would need their own snippet in `site/ads.js` and an update to the privacy page.

## Costs

| Item | Cost | Note |
|---|---|---|
| Domain `.com` | $10.46–11.08 / yr (Cloudflare, Porkbun); Namecheap $11.28 first year, $18.48 renewal | Prices above, before tax |
| GitHub Pages hosting, HTTPS certificate | $0 | Included |
| GitHub Sponsors fee | 0% from personal-account sponsors | Per GitHub docs. Organization sponsors and some payment methods may carry processing fees; check the Sponsors docs before relying on 100% |
| AdSense | $0 to join | Google keeps its revenue share; payouts once the balance passes the payment threshold |
| Consent message (Google Privacy & messaging CMP) | $0, **unverified** | Google's help pages describe it but do not state a price; it is generally offered at no charge inside AdSense |

## Revenue estimate (AdSense, one ad unit)

**Estimates only.** RPM is revenue per 1,000 pageviews. Low case $1–5, optimistic $15. Benchmarks: [MonetizeMore](https://www.monetizemore.com/blog/how-much-should-my-website-be-earning/) puts US English-language RPMs around $4.59–6.15; [WeForAds](https://weforads.com/blog/ad-revenue-benchmarks-2026/) gives $10–25 for technology sites with US traffic and 0.05–0.9× that for most other countries. This site has one unit, a map that fills most of the screen and a global audience, so expect the low end. Nothing here is measured.

| Pageviews / month | Low (RPM $1–5) | Optimistic (RPM $15) | Per year, low to optimistic |
|---|---|---|---|
| 1,000 | $1–5 | $15 | $12–180 |
| 10,000 | $10–50 | $150 | $120–1,800 |
| 100,000 | $100–500 | $1,500 | $1,200–18,000 |

At 1k pageviews a month the domain costs more than the ads earn; Sponsors is the better first step.

## Trade-offs to keep in mind

Ads cost some credibility: this is a research tool cited in conversations with the FAA and NASA, and an ad next to a boom-loudness result reads differently from a clean research page, so keep ads off at least while those conversations are active and prefer Sponsors. Separately, the open freedom-to-operate question on supersonic-routing patents (issue #51) matters more once the site earns money, because commercial use can change the exposure; resolve or at least get it looked at before turning ads on. This is not legal advice.

Data licences allow this: NOAA GFS/GEFS is public domain; ECMWF open data is CC BY 4.0, which permits commercial use with attribution (credited on the Method page); NASA GIBS imagery is credited with its standard acknowledgement on the Method page.
