import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { replyBody, replySubject, leadName, leadNiche, fromEmail } = await request.json();

    if (!replyBody) {
      return NextResponse.json({ success: false, error: "Reply body is required" }, { status: 400 });
    }

    // Get AI settings from database
    const { data: aiSettings } = await supabase
      .from("ai_settings")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!aiSettings || !aiSettings.api_key) {
      return NextResponse.json({ 
        success: false, 
        error: "AI provider not configured. Please set up your AI settings first." 
      }, { status: 400 });
    }

    const provider = aiSettings.provider || "openai";
    const apiKey = aiSettings.api_key;
    const model = aiSettings.model || "gpt-4o-mini";

    // Build the prompt for AI
    const prompt = `You are an AI assistant helping to write a professional email reply.

Original email from ${fromEmail} (${leadName}${leadNiche ? `, ${leadNiche}` : ""}):
Subject: ${replySubject}
Body: ${replyBody}

Generate a professional, friendly reply email. The reply should:
- Be concise and to the point
- Address their inquiry or interest
- Suggest next steps (like scheduling a call)
- Maintain a professional yet warm tone

Return ONLY a JSON object with this exact format:
{
  "subject": "Re: [original subject]",
  "body": "[email body text]"
}`;

    let aiResponse;

    // Call the appropriate AI provider
    if (provider === "openai") {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${error}`);
      }

      const data = await response.json();
      aiResponse = data.choices[0].message.content;
    } else if (provider === "groq") {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Groq API error: ${error}`);
      }

      const data = await response.json();
      aiResponse = data.choices[0].message.content;
    } else {
      return NextResponse.json({ 
        success: false, 
        error: `Unsupported AI provider: ${provider}` 
      }, { status: 400 });
    }

    // Parse the AI response
    let parsedResponse;
    try {
      // Try to extract JSON from the response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      // If parsing fails, create a structured response
      parsedResponse = {
        subject: `Re: ${replySubject}`,
        body: aiResponse,
      };
    }

    return NextResponse.json({
      success: true,
      subject: parsedResponse.subject,
      body: parsedResponse.body,
      model: model,
    });

  } catch (error: any) {
    console.error("Error generating AI reply:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to generate AI reply" },
      { status: 500 }
    );
  }
}
