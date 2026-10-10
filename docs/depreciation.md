# Depreciation rules

SALT uses straight-line depreciation calculated in application code. AI does not calculate financial values.

- Annual depreciation = (purchase value − salvage value) / useful life in years.
- Elapsed years = elapsed UTC milliseconds divided by 365.25 days, with a minimum of zero.
- Accumulated depreciation cannot exceed purchase value minus salvage value.
- Book value cannot fall below salvage value.
- Monetary results are rounded to two decimals; useful life consumed is rounded to one decimal.

For a purchase of $1,500, salvage value of $100, and four-year useful life, annual depreciation is $350. After exactly two 365.25-day years, accumulated depreciation is $700 and book value is $800. Calendar anniversaries can differ slightly because the calculation uses daily proration.

Value retained is book value divided by purchase value. Useful life consumed measures elapsed life instead. The default filter shows assets strictly below 50% retained value. Exactly 50% is excluded. Zero or missing purchase values have no meaningful retained percentage.

The default replacement date adds useful life in calendar years to the purchase date. A recorded replacement date can override it. The date is a planning estimate, not a prediction of failure.

The view and CSV use only backend-authorized records. CSV string cells escape delimiters, quotes, and spreadsheet formula prefixes. USD is the current display currency. This class-scale feature is not a complete financial ledger.
