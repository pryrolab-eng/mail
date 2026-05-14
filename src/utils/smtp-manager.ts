/**
 * SMTP Manager - Handles multiple SMTP accounts with rotation and rate limiting
 * This is a server-side only module
 */

export interface SMTPAccount {
  id: string;
  email: string;
  host: string;
  port: number;
  user: string;
  password: string;
  daily_limit: number;
  sent_today: number;
  last_reset: string;
  status: 'active' | 'paused' | 'error';
  provider: string;
  sender_name?: string; // Display name shown in "From:" field e.g. "Alice Smith"
}

export interface EmailTemplate {
  subject: string;
  body: string;
  variables: string[]; // e.g., ['company_name', 'niche', 'location']
}

/**
 * Personalize email template with lead data
 */
export function personalizeEmail(
  template: string,
  data: Record<string, any>
): string {
  let personalized = template;
  
  // Replace variables like {{company_name}}, {{niche}}, etc.
  Object.keys(data).forEach(key => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    personalized = personalized.replace(regex, data[key] || '');
  });
  
  return personalized;
}

/**
 * Generate AI-powered personalized email using company context
 */
export async function generatePersonalizedEmail(
  lead: {
    company_name: string;
    niche: string;
    location: string;
    company_context: string;
  },
  template: {
    tone: 'professional' | 'casual' | 'friendly';
    purpose: 'introduction' | 'partnership' | 'sales' | 'networking';
    yourCompany: string;
    yourService: string;
  }
): Promise<{ subject: string; body: string }> {
  // This would integrate with OpenAI or another AI service
  // For now, using a smart template system
  
  const { company_name, niche, location, company_context } = lead;
  const { tone, purpose, yourCompany, yourService } = template;
  
  // Extract key insights from company context
  const hasRevenue = company_context.match(/\$[\d.]+[MK]/);
  const hasTeamSize = company_context.match(/(\d+)[-\s]person/);
  const hasFunding = company_context.toLowerCase().includes('raised') || 
                     company_context.toLowerCase().includes('funding');
  
  // Generate personalized subject
  const subjects = {
    introduction: [
      `Quick question about ${company_name}'s ${niche} operations`,
      `Helping ${niche} companies in ${location}`,
      `${company_name} + ${yourCompany} collaboration?`
    ],
    partnership: [
      `Partnership opportunity for ${company_name}`,
      `Scaling ${niche} businesses like ${company_name}`,
      `Let's grow together - ${yourCompany} x ${company_name}`
    ],
    sales: [
      `Boost ${company_name}'s ${niche} performance`,
      `Solution for ${company_name}'s growth`,
      `${yourService} for ${niche} companies`
    ],
    networking: [
      `Connecting with ${niche} leaders in ${location}`,
      `Fellow ${niche} professional reaching out`,
      `Building connections in ${location}'s ${niche} space`
    ]
  };
  
  const subject = subjects[purpose][Math.floor(Math.random() * subjects[purpose].length)];
  
  // Generate personalized body
  let body = '';
  
  if (tone === 'professional') {
    body = `
      <p>Dear ${company_name} Team,</p>
      
      <p>I came across ${company_name} while researching leading ${niche} companies in ${location}, and I was impressed by your work${hasFunding ? ' and recent growth' : ''}.</p>
      
      <p>${company_context.split('.')[0]}. This caught my attention because at ${yourCompany}, we specialize in ${yourService}.</p>
      
      <p>I'd love to explore how we might be able to support ${company_name}'s continued success. Would you be open to a brief conversation?</p>
      
      <p>Best regards,<br>
      [Your Name]<br>
      ${yourCompany}</p>
    `;
  } else if (tone === 'casual') {
    body = `
      <p>Hey there,</p>
      
      <p>I've been following ${company_name} and really dig what you're doing in the ${niche} space${location ? ` in ${location}` : ''}.</p>
      
      <p>${company_context.split('.')[0]}. Pretty cool stuff!</p>
      
      <p>We work with ${niche} companies at ${yourCompany}, helping them with ${yourService}. Thought there might be some synergy here.</p>
      
      <p>Up for a quick chat?</p>
      
      <p>Cheers,<br>
      [Your Name]</p>
    `;
  } else { // friendly
    body = `
      <p>Hi ${company_name} team,</p>
      
      <p>I hope this email finds you well! I recently discovered ${company_name} and was really impressed by your work in ${niche}.</p>
      
      <p>${company_context.split('.')[0]}. It's clear you're doing great things${hasTeamSize ? ' with your team' : ''}!</p>
      
      <p>At ${yourCompany}, we help ${niche} businesses with ${yourService}. I think there could be a great fit here and would love to connect.</p>
      
      <p>Would you be interested in a brief call to explore this?</p>
      
      <p>Looking forward to hearing from you!<br>
      [Your Name]<br>
      ${yourCompany}</p>
    `;
  }
  
  return { subject, body: body.trim() };
}
