import { createClient } from "../../supabase/client";

interface EmailGenerationParams {
  lead: {
    company_name: string;
    niche: string | null;
    location: string | null;
    company_context: string | null;
  };
  yourCompany: string;
  yourService: string;
  tone: 'Direct' | 'Aggressive' | 'Surgical';
  customPainPoint?: string;
  userId: string;
}

export async function generateAIEmail(params: EmailGenerationParams): Promise<{ subject: string; body: string }> {
  const { lead, yourCompany, yourService, tone, customPainPoint, userId } = params;
  
  console.log("Fetching AI provider for userId:", userId);
  
  // Fetch AI provider via API route (uses service role key on server)
  const response = await fetch(`/api/ai-provider?userId=${userId}`);
  
  if (!response.ok) {
    const error = await response.json();
    console.error("AI provider fetch error:", error);
    throw new Error(error.error || "No active AI provider configured. Please set up AI in Settings.");
  }
  
  const aiProvider = await response.json();
  
  // Build the prompt based on tone
  const toneInstructions = {
    'Direct': `Write a HARD DIRECT cold email. NO politeness. NO "reaching out" language. NO fluff.

STRUCTURE (80-120 words total):
1. SUBJECT LINE: State a specific problem they have (e.g., "Your ${lead.niche || 'team'} wastes X hours on [specific task]")
2. OPENING: State the problem immediately. No greetings. No "I came across your company." Just the problem.
3. SOLUTION: One sentence on what ${yourService} does. Be specific about the mechanism.
4. PROOF: One sentence with a concrete result or timeframe.
5. CTA: Direct question. No "Would you be available" or "Looking forward." Just: "15-minute call this week?"

BANNED PHRASES:
- "I'd love to"
- "reaching out"
- "I came across"
- "Looking forward"
- "Would you be available"
- "I hope"
- Any greeting beyond company name

EXAMPLE:
Subject: Your finance team wastes 12 hours monthly on FTSE reporting

Your finance team wastes 12 hours monthly on manual FTSE 250 reporting.

${yourService} automates it. 2-hour setup. Zero manual work after.

Similar companies cut reporting time by 90%.

15-minute call this week?`,

    'Aggressive': `Write a high-urgency, pattern-interrupting cold email that creates genuine FOMO.
- Open with a bold, provocative statement about a costly problem in their industry — make it feel personal
- Quantify the pain: use realistic dollar amounts, percentages, or time wasted
- Name-drop a result you've achieved for a similar company (use a plausible example if needed)
- Create urgency: limited availability, a deadline, or a window they're about to miss
- End with a direct, binary CTA: "Are you open to a 20-minute call this week — yes or no?"
- Aim for 120–180 words — punchy paragraphs, no long blocks of text`,

    'Surgical': `Write a hyper-personalized cold email that proves you did your homework on this specific company.
- Open by referencing something specific from their company context — a recent initiative, their market position, or a detail from their website
- Connect that specific detail to a challenge that naturally follows from it
- Explain how ${yourService} addresses that exact challenge — be specific about the mechanism
- Reference a comparable company or result to build credibility
- Close with a thoughtful, consultative CTA that feels like a natural next step, not a sales push
- Aim for 150–220 words — this is a relationship-building email, not a one-liner`
  };

  const companyContext = lead.company_context 
    ? lead.company_context.slice(0, 800) 
    : 'No additional context available';

  const prompt = `You are an elite B2B cold email copywriter. You write emails that are DIRECT, PROBLEM-FOCUSED, and get responses. NO fluff. NO politeness. NO "reaching out" language.

=== SENDER INFO ===
Company: ${yourCompany}
Service/Product: ${yourService}

=== TARGET COMPANY ===
Company Name: ${lead.company_name}
Industry/Niche: ${lead.niche || 'Unknown'}
Location: ${lead.location || 'Unknown'}
Company Context: ${companyContext}

${customPainPoint ? `=== SPECIFIC PAIN POINT TO ADDRESS ===\n${customPainPoint}\n` : ''}

=== WRITING INSTRUCTIONS ===
${toneInstructions[tone]}

=== CRITICAL RULES ===
- SUBJECT LINE: Must state a specific problem (e.g., "Your team wastes X hours on [task]")
- NO greetings like "Hi", "Hello", "Dear"
- NO "I hope this email finds you well"
- NO "I came across your company"
- NO "reaching out"
- NO "I'd love to"
- NO "Looking forward to"
- NO "Would you be available"
- Start IMMEDIATELY with the problem
- Keep it SHORT: 80-120 words for Direct tone
- Be SPECIFIC about problems in their industry/niche
- End with DIRECT question: "15-minute call this week?" or "Call Tuesday at 2pm?"
- NO signature block, NO name placeholder
- The email must feel like a punch, not a conversation

Format your response EXACTLY like this (no extra text before or after):
SUBJECT: [problem-focused subject line — max 60 characters, no quotes]
BODY: [email body — direct, short, problem-focused]`;

  // Call AI API
  let aiResponse;
  
  try {
    if (aiProvider.provider === "openai") {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${aiProvider.api_key}`
        },
        body: JSON.stringify({
          model: aiProvider.active_model || "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are a HARD DIRECT B2B cold email copywriter. NO politeness. NO fluff. NO 'reaching out' language. Start with the problem. Keep it short (80-120 words). Subject lines must state specific problems. Always follow the exact output format requested." },
            { role: "user", content: prompt }
          ],
          temperature: 0.75,
          max_tokens: 900
        })
      });
      
      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }
      
      const data = await response.json();
      aiResponse = data.choices[0].message.content;
      
    } else if (aiProvider.provider === "anthropic") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": aiProvider.api_key,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: aiProvider.active_model || "claude-3-5-sonnet-20241022",
          max_tokens: 900,
          system: "You are a HARD DIRECT B2B cold email copywriter. NO politeness. NO fluff. NO 'reaching out' language. Start with the problem. Keep it short (80-120 words). Subject lines must state specific problems. Always follow the exact output format requested.",
          messages: [
            { role: "user", content: prompt }
          ]
        })
      });
      
      if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.statusText}`);
      }
      
      const data = await response.json();
      aiResponse = data.content[0].text;
      
    } else if (aiProvider.provider === "groq") {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${aiProvider.api_key}`
        },
        body: JSON.stringify({
          model: aiProvider.active_model || "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: "You are a HARD DIRECT B2B cold email copywriter. NO politeness. NO fluff. NO 'reaching out' language. Start with the problem. Keep it short (80-120 words). Subject lines must state specific problems. Always follow the exact output format requested." },
            { role: "user", content: prompt }
          ],
          temperature: 0.75,
          max_tokens: 900
        })
      });
      
      if (!response.ok) {
        let errorText = '';
        let errorJson = null;
        
        try {
          errorText = await response.text();
          
          if (errorText) {
            try {
              errorJson = JSON.parse(errorText);
            } catch (parseError) {
              // Not JSON, use text as-is
            }
          }
        } catch (e) {
          console.error('Error reading response text:', e);
        }
        
        // Build detailed error message
        let errorMessage = 'Unknown error';
        
        if (errorJson?.error?.message) {
          errorMessage = errorJson.error.message;
        } else if (errorText) {
          errorMessage = errorText.substring(0, 200); // Limit length
        } else if (response.statusText) {
          errorMessage = response.statusText;
        }
        
        // Add helpful context based on status code
        if (response.status === 401) {
          throw new Error('Groq API authentication failed. Please check your API key in Settings.');
        } else if (response.status === 429) {
          throw new Error('Groq rate limit exceeded. Please wait a moment and try again.');
        } else if (response.status === 404) {
          throw new Error(`Groq model "${aiProvider.active_model || "llama-3.3-70b-versatile"}" not found. Please check the model name in Settings.`);
        } else if (response.status === 400) {
          throw new Error(`Groq API error: ${errorMessage}`);
        }
        
        throw new Error(`Groq API error (${response.status}): ${errorMessage}`);
      }
      
      const data = await response.json();
      aiResponse = data.choices[0].message.content;
      
    } else {
      throw new Error(`Unsupported AI provider: ${aiProvider.provider}`);
    }
    
    // Parse the response
    const subjectMatch = aiResponse.match(/SUBJECT:\s*(.+?)(?:\n|$)/i);
    const bodyMatch = aiResponse.match(/BODY:\s*([\s\S]+?)$/i);
    
    if (!subjectMatch || !bodyMatch) {
      throw new Error("AI response format invalid");
    }
    
    return {
      subject: subjectMatch[1].trim(),
      body: bodyMatch[1].trim()
    };
    
  } catch (error) {
    console.error('AI email generation error:', error);
    throw error;
  }
}
