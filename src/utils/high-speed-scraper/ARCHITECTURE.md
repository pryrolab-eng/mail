# Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         HighSpeedScraper                            │
│                    (Main Orchestrator Class)                        │
│                                                                     │
│  • Manages configuration                                           │
│  • Coordinates worker queue                                        │
│  • Handles events and logging                                      │
│  • Exports results                                                 │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           │ creates
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         WorkerQueue                                 │
│                    (Job Queue Manager)                              │
│                                                                     │
│  • Manages job queue (priority-based)                              │
│  • Spawns N concurrent workers                                     │
│  • Tracks in-progress jobs                                         │
│  • Collects results                                                │
│  • Emits progress events                                           │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           │ spawns
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Worker Pool (50-100 workers)                     │
│                                                                     │
│  Worker 1  │  Worker 2  │  Worker 3  │  ...  │  Worker N          │
│     ↓      │     ↓      │     ↓      │       │     ↓              │
│  Process   │  Process   │  Process   │  ...  │  Process           │
│   Job 1    │   Job 2    │   Job 3    │       │   Job N            │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           │ uses
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        RateLimiter                                  │
│                                                                     │
│  • Enforces requests per second limit                              │
│  • Enforces requests per minute limit                              │
│  • Sliding window algorithm                                        │
│  • Blocks workers when limit reached                               │
└─────────────────────────────────────────────────────────────────────┘

                           │
                           │ each worker uses
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Scraper Workers                                │
│                                                                     │
│  ┌──────────────────┐              ┌──────────────────┐           │
│  │  Axios Worker    │              │ Puppeteer Worker │           │
│  │  (Fast, Default) │─────fails───▶│   (Fallback)     │           │
│  │                  │              │                  │           │
│  │  • Axios HTTP    │              │  • Headless      │           │
│  │  • Cheerio parse │              │    browser       │           │
│  │  • Fast & light  │              │  • JS rendering  │           │
│  │  • 90% of sites  │              │  • Slow but      │           │
│  │                  │              │    thorough      │           │
│  └────────┬─────────┘              └────────┬─────────┘           │
│           │                                 │                     │
│           └─────────────┬───────────────────┘                     │
│                         │                                         │
└─────────────────────────┼─────────────────────────────────────────┘
                          │
                          │ extracts HTML
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      EmailExtractor                                 │
│                                                                     │
│  1. Extract mailto: links        (highest priority)                │
│  2. Decode Cloudflare protection (XOR cipher)                      │
│  3. Deobfuscate [at] [dot]       (text replacement)                │
│  4. Extract from plain text      (regex)                           │
│                                                                     │
│  Returns: EmailResult[] with source tracking                       │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           │ validates
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      EmailValidator                                 │
│                                                                     │
│  1. Filter blocked domains       (example.com, test.com, etc.)     │
│  2. Filter blocked prefixes      (noreply, donotreply, etc.)       │
│  3. Filter tracking emails       (analytics, pixel, etc.)          │
│  4. Score email quality          (0-100 based on prefix)           │
│  5. Validate DNS MX records      (optional, with 24h cache)        │
│                                                                     │
│  Returns: Validated & scored emails                                │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           │ selects best
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      BestEmailSelector                              │
│                                                                     │
│  1. Prioritize mailto: links                                       │
│  2. Sort by score (descending)                                     │
│  3. Determine confidence level                                     │
│     • high:   mailto + score ≥70 OR score ≥80                      │
│     • medium: score ≥60                                            │
│     • low:    score <60                                            │
│                                                                     │
│  Returns: Best email + confidence                                  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           │ returns to
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      WorkerQueue                                    │
│                                                                     │
│  • Collects result                                                 │
│  • Updates statistics                                              │
│  • Emits job-complete event                                        │
│  • Stores in results array                                         │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           │ when complete
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Exporter                                    │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │ JSON Export  │  │  CSV Export  │  │ Stats Export │            │
│  │              │  │              │  │              │            │
│  │ • Full data  │  │ • Spreadsheet│  │ • Summary    │            │
│  │ • Metadata   │  │   compatible │  │ • Metrics    │            │
│  │ • Structured │  │ • Easy view  │  │ • Rates      │            │
│  └──────────────┘  └──────────────┘  └──────────────┘            │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Flow

```
URLs Input
    │
    ▼
┌─────────────────┐
│  WorkerQueue    │
│  adds jobs      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  RateLimiter    │
│  checks limit   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Axios Worker   │──fails──┐
│  scrapes HTML   │         │
└────────┬────────┘         │
         │                  │
         │                  ▼
         │         ┌─────────────────┐
         │         │ Puppeteer Worker│
         │         │ scrapes with JS │
         │         └────────┬────────┘
         │                  │
         └──────────┬───────┘
                    │
                    ▼
         ┌─────────────────┐
         │ EmailExtractor  │
         │ finds emails    │
         └────────┬────────┘
                  │
                  ▼
         ┌─────────────────┐
         │ EmailValidator  │
         │ filters & scores│
         └────────┬────────┘
                  │
                  ▼
         ┌─────────────────┐
         │ BestEmailSelect │
         │ picks best      │
         └────────┬────────┘
                  │
                  ▼
         ┌─────────────────┐
         │  ScrapedWebsite │
         │  result object  │
         └────────┬────────┘
                  │
                  ▼
         ┌─────────────────┐
         │  WorkerQueue    │
         │  stores result  │
         └────────┬────────┘
                  │
                  ▼
         ┌─────────────────┐
         │    Exporter     │
         │  JSON/CSV files │
         └─────────────────┘
```

## Component Responsibilities

### HighSpeedScraper (Main Class)
- **Purpose**: Main entry point and orchestrator
- **Responsibilities**:
  - Initialize configuration
  - Create worker queue
  - Setup event listeners
  - Coordinate scraping process
  - Export results
  - Cleanup resources

### WorkerQueue
- **Purpose**: Manage concurrent job processing
- **Responsibilities**:
  - Maintain job queue (priority-based)
  - Spawn N concurrent workers
  - Track in-progress jobs
  - Collect and store results
  - Calculate statistics
  - Emit progress events

### RateLimiter
- **Purpose**: Prevent overwhelming servers
- **Responsibilities**:
  - Track requests per second
  - Track requests per minute
  - Block workers when limit reached
  - Use sliding window algorithm

### Scraper Workers
- **Purpose**: Fetch and parse HTML
- **Responsibilities**:
  - **Axios Worker**: Fast HTTP requests + Cheerio parsing
  - **Puppeteer Worker**: Headless browser for JS-heavy sites
  - Retry logic with exponential backoff
  - Timeout handling
  - Error handling

### EmailExtractor
- **Purpose**: Extract emails from HTML
- **Responsibilities**:
  - Extract mailto: links
  - Decode Cloudflare protection
  - Deobfuscate [at] [dot] patterns
  - Extract from plain text
  - Track email source

### EmailValidator
- **Purpose**: Validate and score emails
- **Responsibilities**:
  - Filter blocked domains
  - Filter blocked prefixes
  - Filter tracking emails
  - Score email quality (0-100)
  - Validate DNS MX records (optional)

### Exporter
- **Purpose**: Export results to files
- **Responsibilities**:
  - Export to JSON (full data)
  - Export to CSV (spreadsheet)
  - Export statistics
  - Export emails only (filtered)

### Logger
- **Purpose**: Logging and progress tracking
- **Responsibilities**:
  - Log at different levels (DEBUG, INFO, WARN, ERROR)
  - Display progress bars
  - Format log messages
  - Track statistics

## Concurrency Model

```
Main Thread
    │
    ├─── Worker 1 ───┐
    ├─── Worker 2 ───┤
    ├─── Worker 3 ───┤
    ├─── Worker 4 ───┼─── All workers run in parallel
    ├─── Worker 5 ───┤     (async/await + Promise.all)
    ├─── ...     ───┤
    └─── Worker N ───┘
         │
         └─── Each worker:
              1. Gets job from queue
              2. Waits for rate limit slot
              3. Scrapes website (Axios or Puppeteer)
              4. Extracts emails
              5. Validates emails
              6. Returns result
              7. Repeats until queue empty
```

## Error Handling Flow

```
Scrape Request
    │
    ▼
Try Axios
    │
    ├─── Success ──────────────────┐
    │                              │
    └─── Fail ──▶ Retry (2x) ──┐  │
                      │         │  │
                      ├─ Success┤  │
                      │         │  │
                      └─ Fail   │  │
                          │     │  │
                          ▼     │  │
                    Try Puppeteer │
                          │     │  │
                          ├─────┘  │
                          │        │
                          └────────┤
                                   │
                                   ▼
                            Return Result
                            (success or error)
```

## Performance Optimization

### 1. Parallel Processing
- 50-100 concurrent workers
- Async/await for non-blocking I/O
- Promise.all for batch processing

### 2. Smart Scraping
- Axios (fast) by default
- Puppeteer (slow) only when needed
- Retry only retryable errors

### 3. Caching
- DNS MX records cached for 24h
- Browser instance reused (Puppeteer)

### 4. Rate Limiting
- Prevents overwhelming servers
- Sliding window algorithm
- Per-second and per-minute limits

### 5. Memory Management
- Streaming processing
- No large arrays in memory
- Automatic cleanup

## Scalability

The system scales horizontally:

```
100 URLs    → 20 workers  → 10-15 seconds
1,000 URLs  → 50 workers  → 1-2 minutes
10,000 URLs → 100 workers → 10-15 minutes
```

Bottlenecks:
1. Network bandwidth
2. CPU (for HTML parsing)
3. Memory (for concurrent workers)
4. Rate limits (external)

Solutions:
1. Increase concurrency
2. Use faster parsing (Cheerio vs Puppeteer)
3. Process in batches
4. Adjust rate limits
