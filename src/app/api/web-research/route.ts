import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, searchQuery, purpose } = body;
    
    if (url) {
      // Research a specific URL (e.g., pryro.com)
      return await researchURL(url, purpose);
    } else if (searchQuery) {
      // Research via search (e.g., "clinic challenges in Rwanda")
      return await researchViaSearch(searchQuery, purpose);
    } else {
      return NextResponse.json(
        { error: 'Either url or searchQuery is required' },
        { status: 400 }
      );
    }
  } catch (error: any) {
    console.error('Web research error:', error);
    return NextResponse.json(
      { error: error.message || 'Web research failed' },
      { status: 500 }
    );
  }
}

async function researchURL(url: string, purpose: string) {
  try {
    // Fetch the webpage content
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    }
    
    const html = await response.text();
    
    // Extract text content (simple extraction)
    const textContent = extractTextFromHTML(html);
    
    // Summarize based on purpose
    let content = '';
    
    if (purpose === 'understand_services') {
      // Extract service-related information
      content = extractServices(textContent);
    } else {
      content = textContent.slice(0, 1000); // First 1000 chars
    }
    
    return NextResponse.json({
      success: true,
      content,
      source: url
    });
  } catch (error: any) {
    console.error('URL research error:', error);
    return NextResponse.json({
      success: false,
      content: 'Failed to research URL',
      error: error.message
    }, { status: 500 });
  }
}

async function researchViaSearch(searchQuery: string, purpose: string) {
  try {
    // Use a simple search approach - in production, you'd use a proper search API
    // For now, we'll return structured insights based on the query
    
    const insights = generateNicheInsights(searchQuery);
    
    return NextResponse.json({
      success: true,
      insights,
      query: searchQuery
    });
  } catch (error: any) {
    console.error('Search research error:', error);
    return NextResponse.json({
      success: false,
      insights: 'Failed to research via search',
      error: error.message
    }, { status: 500 });
  }
}

function extractTextFromHTML(html: string): string {
  // Remove script and style tags
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  
  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  
  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

function extractServices(text: string): string {
  // Look for service-related keywords
  const serviceKeywords = [
    'we offer', 'we provide', 'our services', 'solutions', 'features',
    'helps you', 'enables', 'automate', 'manage', 'platform'
  ];
  
  const sentences = text.split(/[.!?]+/);
  const relevantSentences: string[] = [];
  
  for (const sentence of sentences) {
    const lowerSentence = sentence.toLowerCase();
    if (serviceKeywords.some(keyword => lowerSentence.includes(keyword))) {
      relevantSentences.push(sentence.trim());
      if (relevantSentences.length >= 5) break; // Get first 5 relevant sentences
    }
  }
  
  if (relevantSentences.length > 0) {
    return relevantSentences.join('. ') + '.';
  }
  
  // Fallback: return first 500 characters
  return text.slice(0, 500);
}

function generateNicheInsights(searchQuery: string): string {
  // Extract niche and location from query
  const query = searchQuery.toLowerCase();
  
  // Common niche-specific insights
  const nicheInsights: Record<string, string> = {
    'clinic': `Clinics face several critical challenges: 
    1. Patient Management: Manual record-keeping leads to errors and inefficiencies
    2. Appointment Scheduling: Phone-based booking causes double-bookings and no-shows
    3. Patient Communication: Lack of automated reminders results in missed appointments
    4. Follow-up Care: Difficulty tracking patient follow-ups and treatment adherence
    5. Digital Presence: Limited online visibility makes it hard for patients to find them
    6. Billing & Payments: Manual billing processes are time-consuming and error-prone
    7. Staff Coordination: Poor internal communication affects patient care quality`,
    
    'healthcare': `Healthcare providers struggle with:
    1. Patient Data Management: Fragmented systems make it hard to access patient history
    2. Appointment Efficiency: Manual scheduling wastes staff time and frustrates patients
    3. Patient Engagement: Low patient engagement affects treatment outcomes
    4. Administrative Burden: Staff spend too much time on paperwork instead of patient care
    5. Communication Gaps: Poor communication between departments delays care
    6. Online Presence: Patients expect online booking and digital services
    7. Compliance: Keeping up with healthcare regulations is complex and time-consuming`,
    
    'hospital': `Hospitals deal with:
    1. Complex Patient Flow: Managing patient admissions, transfers, and discharges
    2. Department Coordination: Communication gaps between departments affect care
    3. Resource Management: Inefficient allocation of beds, equipment, and staff
    4. Patient Experience: Long wait times and poor communication frustrate patients
    5. Data Integration: Multiple systems don't talk to each other
    6. Staff Burnout: Administrative burden contributes to healthcare worker fatigue
    7. Emergency Response: Coordinating emergency care requires real-time information`,
    
    'school': `Schools face:
    1. Student Information Management: Manual record-keeping is time-consuming
    2. Parent Communication: Difficulty keeping parents informed and engaged
    3. Attendance Tracking: Manual attendance is prone to errors
    4. Enrollment Process: Paper-based enrollment is slow and inefficient
    5. Academic Performance: Tracking student progress across multiple subjects
    6. Event Management: Coordinating school events and activities
    7. Digital Learning: Limited infrastructure for online and hybrid learning`,
    
    'education': `Educational institutions struggle with:
    1. Student Data Management: Fragmented systems make it hard to track student progress
    2. Parent-Teacher Communication: Lack of efficient communication channels
    3. Administrative Efficiency: Too much time spent on manual administrative tasks
    4. Enrollment Management: Complex enrollment processes deter new students
    5. Learning Management: Need for integrated digital learning platforms
    6. Performance Analytics: Difficulty analyzing student performance data
    7. Resource Allocation: Inefficient use of teaching resources and facilities`,
    
    'restaurant': `Restaurants deal with:
    1. Reservation Management: Phone-based bookings lead to errors and no-shows
    2. Customer Communication: Difficulty sending updates and promotions
    3. Inventory Management: Manual tracking leads to waste and stockouts
    4. Online Ordering: Lack of integrated online ordering systems
    5. Customer Retention: No system to track and reward loyal customers
    6. Staff Scheduling: Manual scheduling is time-consuming and error-prone
    7. Review Management: Difficulty responding to and managing online reviews`,
    
    'retail': `Retail businesses face:
    1. Inventory Management: Manual tracking leads to stockouts and overstocking
    2. Customer Relationships: No system to track customer preferences and history
    3. Online Presence: Limited e-commerce capabilities
    4. Sales Tracking: Manual sales tracking is time-consuming
    5. Customer Communication: Difficulty sending targeted promotions
    6. Loyalty Programs: Complex to manage customer loyalty programs
    7. Multi-channel Sales: Difficulty managing sales across multiple channels`,
  };
  
  // Find matching niche
  for (const [niche, insights] of Object.entries(nicheInsights)) {
    if (query.includes(niche)) {
      return insights;
    }
  }
  
  // Generic fallback
  return `Common business challenges in this sector include:
  1. Digital Transformation: Lack of modern digital tools and systems
  2. Customer Communication: Inefficient communication channels
  3. Administrative Efficiency: Too much time spent on manual tasks
  4. Online Presence: Limited digital visibility and online services
  5. Data Management: Fragmented or manual data management systems
  6. Customer Retention: Difficulty tracking and engaging customers
  7. Operational Efficiency: Manual processes slow down operations`;
}
