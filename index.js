import puppeteer from 'puppeteer'
import fs from 'fs'

(async () => {
  // Get the file path for writing the org data to
  if (process.argv.length !== 3) {
    throw Error("Please provide the file path for where you want the org data written to as a CLI argument")
  }
  const scrapedDataFilePath = process.argv[2]

  const browser = await puppeteer.launch({headless: false})
  const browserPage = await browser.newPage()

  // Print logs from browser console into your terminal
  browserPage.on('console', async (msg) => {
    const msgArgs = msg.args()
    for (let i = 0; i < msgArgs.length; ++i) {
      console.log(await msgArgs[i].jsonValue())
    }
  })

  let orgsData = []

  // Get URLs, total review count, and average rating for each organization's details page 
  for (let i = 1; i <= 2; i++ ){
    console.log(`Processing page ${i} of California orgs`)
    try {
      const data = await scrapeCaliforniaOrgsListPage(browserPage, i)
      orgsData.push(...data)
    } catch (e) {
      console.log(e)
      continue
    }
  }
  console.log(`Found ${orgsData.length} orgs`)

  fs.writeFileSync(scrapedDataFilePath, JSON.stringify(orgsData, null, 2))

  // Visit each org's details page and collect info
  for (let i = 0; i < orgsData.length; i++) {
    console.log(`Processing page for org ${i} - ${orgsData[i].name}`)
    try {
      orgsData[i] = await scrapeOrgPage(browserPage, orgsData[i], i)
    }  catch (e) {
      console.log(e)
      continue
    }
  }

  await browser.close()

  fs.writeFileSync(scrapedDataFilePath, JSON.stringify(orgsData, null, 2))
})()

const scrapeCaliforniaOrgsListPage = async (browserPage, i) => {
  await browserPage.goto(
    `https://greatnonprofits.org/state/California/sort:review_count/direction:desc/page:${i}`,
    {waitUntil: 'networkidle0'},  
  )

  const data = await browserPage.evaluate(() => {
    let orgEls = document.querySelectorAll(`li[typeof='Organization']`)
    let orgs = []
    orgEls.forEach(orgEl => {
      const org = {}
      const pathEl = orgEl.querySelector(`article > div > h2 > a`)
      if (pathEl) {
        org.name = pathEl.innerText.trim()
        const pathStr = pathEl.getAttribute('href')
        if (pathStr){
          org.greatNonProfitsUrl = `https://greatnonprofits.org${pathStr}` 
        }
      } else {
        console.log(`An org on page ${i} is missing a URL and name`)
      }
      const reviewCountEl = orgEl.querySelector(`span[itemprop='reviewCount']`)
      if (reviewCountEl) {
        org.reviewCount = parseInt(reviewCountEl.innerText)
      }

      const ratingValueEl = orgEl.querySelector(`span[itemprop='ratingValue']`)
      if (ratingValueEl && ratingValueEl.innerText.length) {
        org.gnpAvgRating = parseInt(ratingValueEl.innerText[0])
      }

      orgs.push(org)
    })
    return orgs
  })

  return data
}

const scrapeOrgPage = async (browserPage, org, i) => {
  const orgName = org.name
  await browserPage.goto(
    org.greatNonProfitsUrl,
    {waitUntil: 'networkidle0'},  
  )
  
  console.log(`Getting description for org ${i} - ${orgName}`)
  try {
    const description = await browserPage.evaluate(scrapeOrgDescription)
    org.description = description
  } catch (e) {
    console.log(e)
  }

  console.log(`Getting contact info for org ${i} - ${orgName}`)
  try {
    const contactInfo = await browserPage.evaluate(scrapeOrgContactInfo)
    org.contactInfo = contactInfo
  } catch (e) {
    console.log(e)
  }

  console.log(`Getting reviews for org ${i} - ${orgName}`)
  try {
    const reviews = await browserPage.evaluate(scrapeOrgReviews)
    org.reviews = reviews
  } catch (e) {
    console.log(e)
  }

  return org
}

const scrapeOrgDescription = () => {
  const overviewData = {}
  let overviewEl = document.querySelector(`.np-overview`)
  if (!overviewEl) {
    return overviewData
  }
  let subsectionEls = overviewEl.querySelectorAll(`p`)
  for (const subsectionEl of subsectionEls) {
    const categoryEl = subsectionEl.querySelector(`strong`)
    if (categoryEl) {
      const category = categoryEl.innerText
      let subsectionContent = subsectionEl.innerText
      subsectionContent = subsectionContent.replace(`${category}:`, '')
      if (category === 'Causes') {
        let causes = subsectionContent.split(',')
        causes = causes.map(cause => cause.trim())
        overviewData[category] = causes
      } else {
        overviewData[category] = subsectionContent.trim()
      }  
    } else {
      console.log(`Org is missing a category label for a subsection in the description section`)
    }
  }
  return overviewData
}

const scrapeOrgContactInfo = () => {
  const contactData = {}
  const contactEl = document.querySelector(`div[id='np-info']`)
  if (!contactEl) {
    return contactData
  }

  const taxIdEl = contactEl.querySelector(`span[itemprop='taxID']`)
  if (taxIdEl) {
    contactData.taxId = taxIdEl.innerText
  }

  const emailEl = contactEl.querySelector(`a[itemprop='email']`)
  if (emailEl) {
    contactData.email = emailEl.innerText
  }

  const telephoneEl = contactEl.querySelector(`a[itemprop='telephone']`)
  if (telephoneEl) {
    contactData.phoneNumber = telephoneEl.innerText
  }
  
  const linkEls = contactEl.querySelectorAll(`a[itemprop='url']`) || []
  if (linkEls.length > 3) {
    console.log(`Org has more links than expected`)
  }
  linkEls.forEach(linkEl => {
    const url = linkEl.getAttribute('href') || ''
    if (url.includes('facebook')) {
      contactData.facebookUrl = url
    } else if (url.includes('twitter')) {
      contactData.twitterUrl = url
    } else {
      contactData.website = url
    }
  })

  const addressEl = contactEl.querySelector(`li[itemprop='address']`)
  if (addressEl) {
    const addressInfo = {}
    const streetAddressEl = addressEl.querySelector(`span[itemprop='streetAddress']`)
    if (streetAddressEl) {
      addressInfo.street = streetAddressEl.innerText
    }
    const addressLocalityEl = addressEl.querySelector(`span[itemprop='addressLocality']`)
    if (addressLocalityEl) {
      addressInfo.locality = addressLocalityEl.innerText
    }
    const addressRegionEl = addressEl.querySelector(`span[itemprop='addressRegion']`)
    if (addressRegionEl) {
      addressInfo.region = addressRegionEl.innerText
    }
    const postalCodeEl = addressEl.querySelector(`span[itemprop='postalCode']`)
    if (postalCodeEl) {
      addressInfo.postalCode = postalCodeEl.innerText
    }
    const addressCountryEl = addressEl.querySelector(`span[itemprop='addressCountry']`)
    if (addressCountryEl) {
      addressInfo.country = addressCountryEl.innerText
    }
    contactData.address = addressInfo
  }

  return contactData
}

const scrapeOrgReviews = () => {
  let reviewData = []
  const reviewEls = document.querySelectorAll(`div[itemprop='review']`)
  for (const reviewEl of reviewEls) {
    const reviewInfo = {}
    const ratingEl = reviewEl.querySelector(`span[itemprop='ratingValue']`)
    if (ratingEl) {
      reviewInfo.rating = parseInt(ratingEl.innerText)
    }
    const reviewContentEl = reviewEl.querySelector(`div[itemprop='reviewBody']`)
    if (reviewContentEl) {
      reviewInfo.text = reviewContentEl.innerText
    }
    reviewData.push(reviewInfo)
  }

  return reviewData
}