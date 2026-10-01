"""GraphQL documents.

Every field selected here is in Upwork's published schema (reference as of
August 2026). The search selects the search-result node only; the job's
deeper aggregate (screening questions, activity, client company) comes from
``JOB_DETAIL`` when a posting is opened, so a field Upwork withdraws from one
cannot break the other.
"""

from __future__ import annotations

MONEY = "{ rawValue currency displayValue }"

JOB_SEARCH = f"""
query PhoenixJobSearch(
  $marketPlaceJobFilter: MarketplaceJobPostingsSearchFilter,
  $sortAttributes: [MarketplaceJobPostingSearchSortAttribute]
) {{
  marketplaceJobPostingsSearch(
    marketPlaceJobFilter: $marketPlaceJobFilter,
    searchType: USER_JOBS_SEARCH,
    sortAttributes: $sortAttributes
  ) {{
    totalCount
    pageInfo {{ endCursor hasNextPage }}
    edges {{
      cursor
      node {{
        id
        title
        description
        ciphertext
        duration
        durationLabel
        engagement
        amount {MONEY}
        recordNumber
        experienceLevel
        category
        subcategory
        freelancersToHire
        totalFreelancersToHire
        enterprise
        premium
        applied
        totalApplicants
        preferredFreelancerLocation
        preferredFreelancerLocationMandatory
        createdDateTime
        publishedDateTime
        renewedDateTime
        hourlyBudgetType
        hourlyBudgetMin {MONEY}
        hourlyBudgetMax {MONEY}
        weeklyBudget {MONEY}
        engagementDuration {{ id label weeks }}
        relevance {{ effectiveCandidates uniqueImpressions hoursInactive }}
        skills {{ name prettyName highlighted }}
        occupations {{
          category {{ id prefLabel }}
          subCategories {{ id prefLabel }}
          occupationService {{ id prefLabel }}
        }}
        client {{
          totalHires
          totalPostedJobs
          totalSpent {MONEY}
          verificationStatus
          location {{ city country state timezone offsetToUTC }}
          totalReviews
          totalFeedback
          companyRid
          companyName
          lastContractPlatform
          hasFinancialPrivacy
        }}
      }}
    }}
  }}
}}
"""

JOB_DETAIL = f"""
query PhoenixJobDetail($id: ID!) {{
  marketplaceJobPosting(id: $id) {{
    id
    workFlowState {{ status closeResult }}
    content {{ title description }}
    contractTerms {{
      contractType
      onSiteType
      personsToHire
      experienceLevel
      fixedPriceContractTerms {{
        amount {MONEY}
        maxAmount {MONEY}
        engagementDuration {{ id label weeks }}
      }}
      hourlyContractTerms {{
        engagementDuration {{ id label weeks }}
        engagementType
        hourlyBudgetType
        hourlyBudgetMin
        hourlyBudgetMax
      }}
    }}
    classification {{
      category {{ id preferredLabel }}
      subCategory {{ id preferredLabel }}
      occupation {{ id preferredLabel }}
      skills {{ id preferredLabel prettyName }}
      additionalSkills {{ id preferredLabel prettyName }}
    }}
    contractorSelection {{
      proposalRequirement {{
        coverLetterRequired
        freelancerMilestonesAllowed
        screeningQuestions {{ question sequenceNumber }}
      }}
      qualification {{
        contractorType
        englishProficiency
        risingTalent
        jobSuccessScore
        minEarning
        hasPortfolio
      }}
      location {{ countries states timezones localMarket }}
    }}
    activityStat {{
      applicationsBidStats {{
        avgRateBid {MONEY}
        minRateBid {MONEY}
        maxRateBid {MONEY}
        avgInterviewedRateBid {MONEY}
      }}
      jobActivity {{
        lastClientActivity
        invitesSent
        totalInvitedToInterview
        totalHired
        totalUnansweredInvites
        totalOffered
      }}
    }}
    clientCompanyPublic {{
      id
      country {{ name }}
      state
      city
      timezone
      paymentVerification {{ status paymentVerified }}
    }}
    attachments {{ id fileName fileSize link }}
  }}
}}
"""

VIEWER = """
query PhoenixViewer {
  user { id nid name email }
  companySelector { items { title organizationId organizationType typeTitle } }
}
"""

CATEGORIES = """
query PhoenixCategories {
  ontologyCategories {
    id
    preferredLabel
    subcategories { id preferredLabel }
  }
}
"""

SKILL_SEARCH = """
query PhoenixSkillSearch($label: String!, $limit: Int) {
  ontologyElementsSearchByPrefLabel(
    filter: { preferredLabel_any: $label, type: SKILL, limit: $limit }
  ) {
    id
    preferredLabel
  }
}
"""
