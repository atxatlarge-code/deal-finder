# Scoring Algorithm

## Overview

The Deal Engine scores properties based on "seller intent signals" — events that indicate a property owner may be motivated to sell. Scores range from 0-100 and are recalculated periodically.

## Formula

```
Score = min(100, round((base + absentee_bonus) × ownership_multiplier))
```

## Signal Weights

| Signal Type | Points | Description |
|-------------|--------|-------------|
| FORECLOSURE | 40 | Foreclosure filing |
| DIVORCE | 35 | Divorce filing involving property owner |
| BANKRUPTCY | 35 | Bankruptcy filing (Chapter 7, 11, 13) |
| TAX_DELINQUENCY | 30 | Tax delinquency on property |
| CODE_VIOLATION | 20 | Code compliance violations |
| VACANT | 15 | Vacant property status |
| EMERGENCY | 100 | Emergency substandard structure |

## How Scores Are Calculated

### 1. Base Score
Sum of signal weights. For repeated signals of the same type, there's a diminishing returns bonus:
- First signal: full weight
- 2nd-4th additional signals of same type: +5 pts each
- 5th+ additional: no extra points

### 2. Diversity Bonus
+10 points if the property has **2 or more different types** of signals. This rewards properties with multiple distress indicators.

### 3. Absentee Bonus
+15 points (added before multiplier) if the property owner has a mailing address different from the property address.

### 4. Ownership Multiplier
After adding bonuses, the score is multiplied based on ownership type:

| Ownership Type | Multiplier |
|----------------|------------|
| ESTATE | 1.2x |
| TRUST | 1.15x |
| LLC | 1.1x |
| INDIVIDUAL | 1.0x |

> **Why?** Estate and trust properties often indicate Probate/Heir situations — high-potential deals with motivated sellers.

### 5. Cap
Final score is capped at 100.

## Score Bands

| Score Range | Band | Badge Color |
|-------------|------|-------------|
| ≥ 70 | High | Black |
| ≥ 50 | Medium | Gray |
| < 50 | Low | Muted |

## Example Calculation

**Property:** 123 Main St  
**Owner:** LLC  
**Absentee:** Yes  
**Signals:** 1 BANKRUPTCY, 2 CODE_VIOLATION

```
Base:
  - BANKRUPTCY: 35 pts
  - CODE_VIOLATION: 20 + (1 extra × 5) = 25 pts
  - Diversity bonus (2 types): +10 pts
  = 70 pts

Absentee bonus: +15 = 85 pts

Ownership multiplier (LLC): 85 × 1.1 = 93.5 → 94
```

Final Score: **94** (High)

## Data Sources

- **Bankruptcy:** CourtListener RECAP API (TXNB court)
- **Code Violations:** Dallas 311 Open Data
- **Divorce/Foreclosure/Tax:** Dallas County records
- **Vacancy:** DCAD property status

## Score Updates

Scores are recalculated when:
1. New signals are detected via webhooks (e.g., bankruptcy filings)
2. The daily cron job runs (`POST /api/cron/score`)
3. Properties with signals older than 180 days are excluded

Scores are versioned — each recalculation creates new score records rather than updating existing ones.

## Interpreting Scores

- **90-100:** Multiple strong signals + favorable ownership type. Top priority.
- **70-89:** Strong signals present. Good deal potential.
- **50-69:** Some distress indicators. Moderate priority.
- **<50:** Few or weak signals. Lower priority but may still have value.