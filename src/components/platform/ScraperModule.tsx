"use client";

import { useState, useEffect } from "react";
import { ScrapedLead } from "@/types/platform";
import {
  Radio,
  Search,
  MapPin,
  Plus,
  Download,
  ChevronRight,
  X,
  CheckSquare,
  Square,
  Loader2,
  ChevronLeft,
  ExternalLink,
  Mail,
  Send,
  Zap,
} from "lucide-react";
import { createClient } from "../../../supabase/client";
import { toast } from "sonner";
import BulkEmailSender from "./BulkEmailSender";
import { scrapeLeadsAction } from "@/app/actions";

interface ScraperModuleProps {
  userId: string;
  onLeadsAdded?: () => void;
  onGenerateEmails?: (leads: ScrapedLead[]) => void;
}

// Expanded mock leads database with 100+ entries
const MOCK_LEADS: ScrapedLead[] = [
  // SaaS Companies
  {
    company_name: "CloudStack Solutions",
    email: "info@cloudstack.dev",
    niche: "SaaS",
    location: "San Francisco, USA",
    company_context: "CloudStack is a B2B SaaS platform that automates cloud cost management for mid-market tech companies. They recently raised Series A funding of $8M and are scaling their sales team aggressively.",
  },
  {
    company_name: "DataFlow Systems",
    email: "contact@dataflow.io",
    niche: "SaaS",
    location: "Austin, TX",
    company_context: "DataFlow provides real-time data pipeline solutions for enterprise clients. 50-person team focused on financial services and healthcare verticals.",
  },
  {
    company_name: "ProjectHub Pro",
    email: "hello@projecthub.com",
    niche: "SaaS",
    location: "Seattle, USA",
    company_context: "Project management SaaS serving 500+ companies. Recently launched AI-powered resource allocation features. Growing 40% YoY.",
  },
  {
    company_name: "SecureVault Inc",
    email: "sales@securevault.co",
    niche: "SaaS",
    location: "Boston, USA",
    company_context: "Cybersecurity SaaS platform for SMBs. Provides automated threat detection and compliance reporting. $2M ARR, seeking Series A.",
  },
  {
    company_name: "TeamSync Solutions",
    email: "info@teamsync.app",
    niche: "SaaS",
    location: "Denver, USA",
    company_context: "Remote team collaboration platform with integrated video and project management. 10,000+ active users across 40 countries.",
  },
  
  // E-Commerce
  {
    company_name: "Nomad eCommerce",
    email: "growth@nomad-ec.com",
    niche: "E-Commerce",
    location: "Amsterdam, Netherlands",
    company_context: "Multi-brand DTC portfolio with 4 active brands in outdoor apparel. Annual GMV of approximately €12M. Seeking to improve email marketing automation.",
  },
  {
    company_name: "EcoMarket Global",
    email: "partnerships@ecomarket.com",
    niche: "E-Commerce",
    location: "Portland, USA",
    company_context: "Sustainable products marketplace with 5000+ SKUs. B2C and B2B channels. Focusing on expanding wholesale partnerships.",
  },
  {
    company_name: "LuxStyle Fashion",
    email: "hello@luxstyle.co",
    niche: "E-Commerce",
    location: "Milan, Italy",
    company_context: "High-end fashion e-commerce platform. €8M annual revenue. Looking to expand to US market with influencer partnerships.",
  },
  {
    company_name: "TechGadgets Direct",
    email: "sales@techgadgets.com",
    niche: "E-Commerce",
    location: "Shenzhen, China",
    company_context: "Electronics and gadgets DTC brand. Strong presence in Asian markets, now targeting Europe and North America.",
  },
  {
    company_name: "HomeDecor Plus",
    email: "info@homedecorplus.com",
    niche: "E-Commerce",
    location: "Los Angeles, USA",
    company_context: "Home furnishings marketplace connecting artisans with consumers. $5M GMV in 2023, scaling logistics operations.",
  },
  
  // Digital Marketing Agencies
  {
    company_name: "Apex Digital Agency",
    email: "hello@apexdigital.io",
    niche: "Digital Marketing",
    location: "New York, USA",
    company_context: "Full-service digital marketing agency specializing in paid media, SEO, and conversion optimization for e-commerce brands. Manages over $5M in monthly ad spend.",
  },
  {
    company_name: "Growth Catalyst Marketing",
    email: "team@growthcatalyst.com",
    niche: "Digital Marketing",
    location: "London, UK",
    company_context: "Performance marketing agency focused on SaaS and fintech clients. 30-person team, specializing in growth hacking and conversion rate optimization.",
  },
  {
    company_name: "Viral Reach Media",
    email: "hello@viralreach.co",
    niche: "Digital Marketing",
    location: "Miami, USA",
    company_context: "Social media marketing agency with expertise in TikTok and Instagram. Works with 50+ influencer brands and creators.",
  },
  {
    company_name: "SEO Masters Ltd",
    email: "contact@seomasters.com",
    niche: "Digital Marketing",
    location: "Toronto, Canada",
    company_context: "Technical SEO agency serving enterprise clients. Known for handling complex international SEO projects and technical audits.",
  },
  {
    company_name: "ConversionLab",
    email: "info@conversionlab.io",
    niche: "Digital Marketing",
    location: "Berlin, Germany",
    company_context: "CRO-focused agency running A/B tests and optimization programs for high-traffic e-commerce sites. Data-driven approach.",
  },
  
  // Fintech
  {
    company_name: "PayFlow Systems",
    email: "business@payflow.com",
    niche: "Fintech",
    location: "Singapore",
    company_context: "B2B payment processing platform for Southeast Asian markets. Processing $100M monthly volume across 8 countries.",
  },
  {
    company_name: "CryptoVault Pro",
    email: "support@cryptovault.io",
    niche: "Fintech",
    location: "Zurich, Switzerland",
    company_context: "Institutional-grade crypto custody solution. Serving family offices and hedge funds. $500M assets under custody.",
  },
  {
    company_name: "LendTech Solutions",
    email: "info@lendtech.com",
    niche: "Fintech",
    location: "Dublin, Ireland",
    company_context: "SMB lending platform using alternative credit scoring. Funded 2000+ businesses with $50M in total loans.",
  },
  {
    company_name: "WealthWise App",
    email: "hello@wealthwise.co",
    niche: "Fintech",
    location: "Sydney, Australia",
    company_context: "Personal finance management app with 100K+ users. Focuses on millennial and Gen-Z savings and investment behavior.",
  },
  {
    company_name: "InsureTech Partners",
    email: "contact@insuretech.com",
    niche: "Fintech",
    location: "Hartford, USA",
    company_context: "Insurance technology platform streamlining claims processing. Working with 15 insurance carriers across North America.",
  },
  
  // Health Tech
  {
    company_name: "Pulse Health Tech",
    email: "bd@pulsehealth.co",
    niche: "Health Tech",
    location: "Toronto, Canada",
    company_context: "Remote patient monitoring software for hospital networks. Currently serving 12 hospital systems in North America.",
  },
  {
    company_name: "MediConnect Platform",
    email: "info@mediconnect.health",
    niche: "Health Tech",
    location: "Boston, USA",
    company_context: "Telemedicine platform connecting patients with specialists. 500+ doctors on platform, 50K monthly consultations.",
  },
  {
    company_name: "HealthData Analytics",
    email: "contact@healthdata.io",
    niche: "Health Tech",
    location: "Palo Alto, USA",
    company_context: "Healthcare data analytics using AI for predictive diagnostics. Partnered with 30 hospital systems for clinical trials.",
  },
  {
    company_name: "PharmaTech Solutions",
    email: "hello@pharmatech.com",
    niche: "Health Tech",
    location: "Basel, Switzerland",
    company_context: "Pharmaceutical supply chain optimization platform. Tracking $2B in pharmaceutical inventory across Europe.",
  },
  {
    company_name: "FitLife Wellness",
    email: "team@fitlifewellness.co",
    niche: "Health Tech",
    location: "Vancouver, Canada",
    company_context: "Corporate wellness platform with biometric tracking. Serving 200+ companies with 50K+ employee users.",
  },
  
  // Real Estate
  {
    company_name: "PropTech Ventures",
    email: "info@proptech.ventures",
    niche: "Real Estate",
    location: "Dubai, UAE",
    company_context: "Real estate investment platform using blockchain for fractional ownership. $200M in property listings.",
  },
  {
    company_name: "SmartHome Realty",
    email: "hello@smarthomerealty.com",
    niche: "Real Estate",
    location: "Atlanta, USA",
    company_context: "Tech-enabled real estate brokerage specializing in smart home installations. 100+ agents, $500M annual transaction volume.",
  },
  {
    company_name: "UrbanNest Properties",
    email: "contact@urbannest.co",
    niche: "Real Estate",
    location: "Brooklyn, USA",
    company_context: "Boutique property management firm managing 500+ rental units in NYC. Focus on luxury short-term rentals.",
  },
  {
    company_name: "Global Property Hub",
    email: "sales@globalpropertyhub.com",
    niche: "Real Estate",
    location: "London, UK",
    company_context: "International real estate marketplace for high-net-worth individuals. Listing properties in 45 countries.",
  },
  {
    company_name: "BuildTech Analytics",
    email: "info@buildtech.io",
    niche: "Real Estate",
    location: "Austin, TX",
    company_context: "Construction project management software for commercial real estate developers. Used on $5B worth of projects.",
  },
  
  // Education
  {
    company_name: "EduTech Academy",
    email: "hello@edutech.academy",
    niche: "Education",
    location: "Singapore",
    company_context: "Online learning platform for K-12 STEM education. 100K+ students across Asia-Pacific region.",
  },
  {
    company_name: "SkillBoost Platform",
    email: "contact@skillboost.com",
    niche: "Education",
    location: "San Francisco, USA",
    company_context: "Professional development courses for tech workers. 500+ courses, partnerships with Google and Microsoft.",
  },
  {
    company_name: "LanguageLearn AI",
    email: "info@languagelearn.ai",
    niche: "Education",
    location: "Barcelona, Spain",
    company_context: "AI-powered language learning app with 2M users. Focuses on conversational practice with speech recognition.",
  },
  {
    company_name: "Campus Connect",
    email: "team@campusconnect.edu",
    niche: "Education",
    location: "Chicago, USA",
    company_context: "University student engagement platform. Used by 50 universities for event management and student communications.",
  },
  {
    company_name: "MathGenius Tutoring",
    email: "hello@mathgenius.com",
    niche: "Education",
    location: "Mumbai, India",
    company_context: "Online math tutoring platform connecting students with expert tutors. 10K active students, expanding to US market.",
  },
  
  // Consulting
  {
    company_name: "Meridian Consulting",
    email: "contact@meridianconsult.com",
    niche: "Consulting",
    location: "London, UK",
    company_context: "Boutique management consultancy focused on operational efficiency for financial services firms. 28-person team.",
  },
  {
    company_name: "TechStrategy Partners",
    email: "info@techstrategy.com",
    niche: "Consulting",
    location: "San Francisco, USA",
    company_context: "Digital transformation consulting for Fortune 500 companies. Specializing in cloud migration and AI implementation.",
  },
  {
    company_name: "Growth Advisory Group",
    email: "hello@growthadvisory.co",
    niche: "Consulting",
    location: "New York, USA",
    company_context: "M&A advisory and growth strategy consulting for tech startups preparing for Series B and beyond.",
  },
  {
    company_name: "Sustainability Consultants",
    email: "contact@sustainconsult.com",
    niche: "Consulting",
    location: "Stockholm, Sweden",
    company_context: "ESG and sustainability strategy consulting. Helping companies achieve carbon neutrality and ESG compliance.",
  },
  {
    company_name: "HR Excellence Partners",
    email: "team@hrexcellence.com",
    niche: "Consulting",
    location: "Chicago, USA",
    company_context: "Human resources consulting specializing in remote work policies and organizational design for tech companies.",
  },
  
  // Venture Capital
  {
    company_name: "TechFlow Ventures",
    email: "founders@techflow.vc",
    niche: "Venture Capital",
    location: "Austin, TX",
    company_context: "Early-stage VC firm focused on B2B SaaS and fintech. Managing a $45M fund with 8-12 investments per year.",
  },
  {
    company_name: "Innovation Capital Partners",
    email: "contact@innovationcap.com",
    niche: "Venture Capital",
    location: "Palo Alto, USA",
    company_context: "Seed-stage VC fund focusing on AI and machine learning startups. $100M under management, 40 portfolio companies.",
  },
  {
    company_name: "GreenTech Ventures",
    email: "hello@greentech.vc",
    niche: "Venture Capital",
    location: "Berlin, Germany",
    company_context: "Climate tech and clean energy VC fund. €200M fund targeting European sustainability startups.",
  },
  {
    company_name: "Digital Frontier Fund",
    email: "info@digitalfrontier.vc",
    niche: "Venture Capital",
    location: "Singapore",
    company_context: "Early-stage fund focused on Southeast Asian tech startups. 25 portfolio companies across fintech and e-commerce.",
  },
  {
    company_name: "HealthTech Investors",
    email: "team@healthtechinvest.com",
    niche: "Venture Capital",
    location: "Boston, USA",
    company_context: "Healthcare and biotech-focused VC firm. $150M fund targeting digital health and medical devices.",
  },
  
  // Data Analytics
  {
    company_name: "DataBridge Analytics",
    email: "hello@databridge.ai",
    niche: "Data Analytics",
    location: "Berlin, Germany",
    company_context: "Predictive analytics dashboards for manufacturing companies. ML models reduce downtime by 23% on average.",
  },
  {
    company_name: "InsightFlow Systems",
    email: "contact@insightflow.com",
    niche: "Data Analytics",
    location: "Seattle, USA",
    company_context: "Business intelligence platform for retail chains. Real-time analytics across 1000+ store locations.",
  },
  {
    company_name: "MetricsPro Analytics",
    email: "info@metricspro.io",
    niche: "Data Analytics",
    location: "Toronto, Canada",
    company_context: "Marketing analytics platform tracking multi-channel attribution. Serving 300+ e-commerce brands.",
  },
  {
    company_name: "CustomerIQ Platform",
    email: "hello@customeriq.com",
    niche: "Data Analytics",
    location: "Austin, TX",
    company_context: "Customer behavior analytics using AI to predict churn and optimize retention strategies.",
  },
  {
    company_name: "SupplyChain Analytics",
    email: "team@supplychainai.com",
    niche: "Data Analytics",
    location: "Chicago, USA",
    company_context: "Supply chain optimization using predictive analytics. Serving logistics companies managing $10B in shipments.",
  },
  
  // PR & Media
  {
    company_name: "Velocity PR",
    email: "press@velocitypr.agency",
    niche: "Public Relations",
    location: "Los Angeles, USA",
    company_context: "Tech and entertainment PR, securing placements in TechCrunch, Wired, and Forbes. Working with 30+ startups.",
  },
  {
    company_name: "BrandVoice Communications",
    email: "hello@brandvoice.com",
    niche: "Public Relations",
    location: "New York, USA",
    company_context: "B2B PR agency specializing in thought leadership and executive positioning for SaaS companies.",
  },
  {
    company_name: "MediaReach Partners",
    email: "contact@mediareach.co",
    niche: "Public Relations",
    location: "London, UK",
    company_context: "International PR firm with offices in 12 countries. Focus on crisis communications and reputation management.",
  },
  {
    company_name: "TechPress Agency",
    email: "info@techpress.io",
    niche: "Public Relations",
    location: "San Francisco, USA",
    company_context: "PR agency exclusively for tech startups. Secured 500+ media placements in tier-1 publications.",
  },
  {
    company_name: "Influence Networks",
    email: "team@influencenet.com",
    niche: "Public Relations",
    location: "Miami, USA",
    company_context: "Influencer PR connecting brands with social media influencers. Network of 5000+ verified influencers.",
  },
  
  // Manufacturing
  {
    company_name: "PrecisionTech Manufacturing",
    email: "sales@precisiontech.com",
    niche: "Manufacturing",
    location: "Detroit, USA",
    company_context: "Precision parts manufacturer for automotive and aerospace. ISO 9001 certified, $50M annual revenue.",
  },
  {
    company_name: "EcoManufacture Solutions",
    email: "info@ecomanufacture.com",
    niche: "Manufacturing",
    location: "Portland, USA",
    company_context: "Sustainable manufacturing using recycled materials. B2B supplier for eco-conscious consumer brands.",
  },
  {
    company_name: "SmartFactory Systems",
    email: "hello@smartfactory.io",
    niche: "Manufacturing",
    location: "Stuttgart, Germany",
    company_context: "IoT-enabled smart manufacturing platform. Helping factories implement Industry 4.0 automation.",
  },
  {
    company_name: "Global Components Ltd",
    email: "contact@globalcomponents.com",
    niche: "Manufacturing",
    location: "Shenzhen, China",
    company_context: "Electronic components manufacturer and distributor. Serving 500+ tech companies worldwide.",
  },
  {
    company_name: "CustomFab Industries",
    email: "team@customfab.com",
    niche: "Manufacturing",
    location: "Houston, USA",
    company_context: "Custom metal fabrication for oil & gas and construction industries. 200-person facility with advanced CNC capabilities.",
  },
  
  // Retail
  {
    company_name: "RetailTech Innovations",
    email: "info@retailtech.com",
    niche: "Retail",
    location: "New York, USA",
    company_context: "Point-of-sale and inventory management software for retail chains. 2000+ store locations using the platform.",
  },
  {
    company_name: "ShopLocal Network",
    email: "hello@shoplocal.com",
    niche: "Retail",
    location: "Seattle, USA",
    company_context: "Platform connecting local retail stores with online shoppers. GMV of $20M across 500 independent retailers.",
  },
  {
    company_name: "LuxuryRetail Partners",
    email: "contact@luxuryretail.co",
    niche: "Retail",
    location: "Paris, France",
    company_context: "Luxury retail consulting and merchandising. Working with high-end fashion and jewelry brands across Europe.",
  },
  {
    company_name: "FreshMarket Solutions",
    email: "sales@freshmarket.com",
    niche: "Retail",
    location: "Chicago, USA",
    company_context: "Grocery retail technology including self-checkout and inventory tracking. Deployed in 100+ supermarkets.",
  },
  {
    company_name: "PopUp Retail Systems",
    email: "info@popupretail.io",
    niche: "Retail",
    location: "Los Angeles, USA",
    company_context: "Pop-up store management platform. Helps brands launch temporary retail experiences in high-traffic locations.",
  },
  
  // Additional SaaS Companies (to reach 100+)
  {
    company_name: "WorkflowPro Systems",
    email: "hello@workflowpro.com",
    niche: "SaaS",
    location: "Boston, USA",
    company_context: "Business process automation platform for enterprises. 300+ customers including Fortune 500 companies.",
  },
  {
    company_name: "ChatSupport AI",
    email: "info@chatsupport.ai",
    niche: "SaaS",
    location: "Tel Aviv, Israel",
    company_context: "AI-powered customer support chatbot. Handling 5M customer conversations monthly across 20 languages.",
  },
  {
    company_name: "DocuFlow Solutions",
    email: "contact@docuflow.com",
    niche: "SaaS",
    location: "Sydney, Australia",
    company_context: "Document management and e-signature platform. Serving legal and financial services sectors.",
  },
  {
    company_name: "SalesForce Accelerator",
    email: "team@salesforceacc.com",
    niche: "SaaS",
    location: "Denver, USA",
    company_context: "Sales enablement platform with AI-driven lead scoring. 5000+ sales reps using the platform daily.",
  },
  {
    company_name: "CloudBackup Pro",
    email: "hello@cloudbackup.io",
    niche: "SaaS",
    location: "Amsterdam, Netherlands",
    company_context: "Enterprise cloud backup and disaster recovery. Protecting 10PB of data for 500+ companies.",
  },
  {
    company_name: "TimeTracker Plus",
    email: "info@timetracker.com",
    niche: "SaaS",
    location: "Toronto, Canada",
    company_context: "Time tracking and productivity software for remote teams. 50K+ users across professional services firms.",
  },
  {
    company_name: "InvoiceMaster Pro",
    email: "contact@invoicemaster.com",
    niche: "SaaS",
    location: "London, UK",
    company_context: "Automated invoicing and accounts receivable platform for SMBs. Processing £500M in annual invoices.",
  },
  {
    company_name: "RecruitHub Systems",
    email: "hello@recruithub.io",
    niche: "SaaS",
    location: "Austin, TX",
    company_context: "Applicant tracking system for mid-market companies. 200+ HR teams using the platform for recruiting.",
  },
  {
    company_name: "EmailFlow Marketing",
    email: "team@emailflow.com",
    niche: "SaaS",
    location: "San Diego, USA",
    company_context: "Email marketing automation platform. 10K+ businesses sending 100M+ emails monthly.",
  },
  {
    company_name: "AnalyticsDash Pro",
    email: "info@analyticsdash.com",
    niche: "SaaS",
    location: "Singapore",
    company_context: "Real-time business intelligence dashboards. Integrates with 50+ data sources including Salesforce and HubSpot.",
  },
  
  // More E-Commerce
  {
    company_name: "BeautyBox Direct",
    email: "hello@beautybox.com",
    niche: "E-Commerce",
    location: "Seoul, South Korea",
    company_context: "K-beauty subscription box service. 50K subscribers, expanding to US and European markets.",
  },
  {
    company_name: "PetSupply Central",
    email: "contact@petsupply.com",
    niche: "E-Commerce",
    location: "Phoenix, USA",
    company_context: "Online pet supplies retailer. $15M annual revenue, focusing on premium and organic pet products.",
  },
  {
    company_name: "BookLovers Marketplace",
    email: "info@booklovers.com",
    niche: "E-Commerce",
    location: "Edinburgh, UK",
    company_context: "Online marketplace for rare and collectible books. 100K+ listings from independent booksellers.",
  },
  {
    company_name: "FitGear Online",
    email: "sales@fitgear.com",
    niche: "E-Commerce",
    location: "Melbourne, Australia",
    company_context: "Fitness equipment e-commerce store. Strong social media presence with 500K+ followers.",
  },
  {
    company_name: "ArtisanCraft Market",
    email: "hello@artisancraft.com",
    niche: "E-Commerce",
    location: "Portland, USA",
    company_context: "Handmade goods marketplace connecting artisans with buyers. 10K active sellers, $8M GMV.",
  },
  
  // More Digital Marketing
  {
    company_name: "PPC Masters Agency",
    email: "contact@ppcmasters.com",
    niche: "Digital Marketing",
    location: "Chicago, USA",
    company_context: "Pay-per-click advertising specialists managing $10M+ in monthly ad spend across Google and Facebook.",
  },
  {
    company_name: "ContentKings Media",
    email: "hello@contentkings.io",
    niche: "Digital Marketing",
    location: "Austin, TX",
    company_context: "Content marketing agency creating long-form content for B2B SaaS companies. 20-person editorial team.",
  },
  {
    company_name: "LocalSEO Experts",
    email: "info@localseo.com",
    niche: "Digital Marketing",
    location: "Denver, USA",
    company_context: "Local SEO and Google My Business optimization for multi-location businesses. 300+ clients.",
  },
  {
    company_name: "VideoMarketing Pro",
    email: "team@videomarketing.com",
    niche: "Digital Marketing",
    location: "Los Angeles, USA",
    company_context: "Video content production and marketing for brands. Specializing in YouTube and TikTok strategies.",
  },
  {
    company_name: "EmailCampaign Masters",
    email: "hello@emailcampaign.com",
    niche: "Digital Marketing",
    location: "Boston, USA",
    company_context: "Email marketing specialists for e-commerce brands. Managing campaigns generating $50M+ in attributed revenue.",
  },
  
  // More Fintech
  {
    company_name: "BudgetApp Plus",
    email: "support@budgetapp.io",
    niche: "Fintech",
    location: "San Francisco, USA",
    company_context: "Personal budgeting app with 500K users. AI-powered spending insights and savings recommendations.",
  },
  {
    company_name: "TradeFlow Platform",
    email: "info@tradeflow.com",
    niche: "Fintech",
    location: "New York, USA",
    company_context: "Stock trading platform for active traders. $5B in annual trading volume, commission-free trading.",
  },
  {
    company_name: "RemitEasy Solutions",
    email: "hello@remiteasy.com",
    niche: "Fintech",
    location: "London, UK",
    company_context: "International money transfer service. $500M processed annually across 50 countries with low fees.",
  },
  {
    company_name: "SmallBiz Loans",
    email: "contact@smallbizloans.com",
    niche: "Fintech",
    location: "Atlanta, USA",
    company_context: "Alternative lending platform for small businesses. $100M in loans funded, average 48-hour approval time.",
  },
  {
    company_name: "CryptoTax Helper",
    email: "team@cryptotax.io",
    niche: "Fintech",
    location: "Austin, TX",
    company_context: "Cryptocurrency tax software for traders and accountants. Supporting 100+ exchanges and blockchains.",
  },
  
  // More Health Tech
  {
    company_name: "MentalHealth Connect",
    email: "info@mentalhealthconnect.com",
    niche: "Health Tech",
    location: "Seattle, USA",
    company_context: "Teletherapy platform connecting patients with licensed therapists. 50K active users, 200+ therapists.",
  },
  {
    company_name: "FitnessTracker Pro",
    email: "hello@fitnesstracker.io",
    niche: "Health Tech",
    location: "San Diego, USA",
    company_context: "Wearable fitness device and app ecosystem. 1M+ devices sold, growing subscription revenue from premium features.",
  },
  {
    company_name: "PharmaDelivery Now",
    email: "contact@pharmadeliver.com",
    niche: "Health Tech",
    location: "Miami, USA",
    company_context: "Prescription delivery marketplace. Partnered with 500+ pharmacies for same-day medication delivery.",
  },
  {
    company_name: "HealthRecords Vault",
    email: "info@healthrecords.io",
    niche: "Health Tech",
    location: "Phoenix, USA",
    company_context: "Personal health records platform using blockchain for security. 200K users storing medical histories.",
  },
  {
    company_name: "NutritionAI Coach",
    email: "team@nutritionai.com",
    niche: "Health Tech",
    location: "Los Angeles, USA",
    company_context: "AI-powered nutrition coaching app with personalized meal plans. 100K subscribers paying $10/month.",
  },
  
  // Additional diverse companies
  {
    company_name: "GreenEnergy Solutions",
    email: "hello@greenenergy.com",
    niche: "Clean Energy",
    location: "Copenhagen, Denmark",
    company_context: "Solar panel installation and maintenance for commercial properties. Installed 50MW of solar capacity.",
  },
  {
    company_name: "LogisticsPro Systems",
    email: "info@logisticspro.com",
    niche: "Logistics",
    location: "Rotterdam, Netherlands",
    company_context: "Freight forwarding and supply chain management. Managing shipments across Europe and Asia.",
  },
  {
    company_name: "TravelTech Ventures",
    email: "contact@traveltech.com",
    niche: "Travel",
    location: "Barcelona, Spain",
    company_context: "Travel booking platform focusing on sustainable tourism. 100K bookings annually across 50 countries.",
  },
  {
    company_name: "FoodDelivery Express",
    email: "hello@foodexpress.com",
    niche: "Food Delivery",
    location: "Tokyo, Japan",
    company_context: "Restaurant delivery platform operating in 20 cities across Japan. 5000+ restaurant partners.",
  },
  {
    company_name: "LegalTech Solutions",
    email: "info@legaltech.io",
    niche: "Legal",
    location: "Washington DC, USA",
    company_context: "Legal document automation and case management software for law firms. 500+ firms using the platform.",
  },
  {
    company_name: "ConstructTech Pro",
    email: "team@constructtech.com",
    niche: "Construction",
    location: "Dallas, USA",
    company_context: "Construction project management software. Managing $10B in active construction projects nationwide.",
  },
  {
    company_name: "AgriTech Innovations",
    email: "hello@agritech.com",
    niche: "Agriculture",
    location: "Des Moines, USA",
    company_context: "Precision agriculture using IoT sensors and drones. Serving 1000+ farms across the Midwest.",
  },
  {
    company_name: "AutoParts Marketplace",
    email: "sales@autoparts.com",
    niche: "Automotive",
    location: "Detroit, USA",
    company_context: "Online automotive parts marketplace connecting buyers with suppliers. $50M GMV annually.",
  },
  {
    company_name: "EventPro Platform",
    email: "info@eventpro.io",
    niche: "Events",
    location: "Las Vegas, USA",
    company_context: "Event management platform for conferences and trade shows. Powered 500+ events with 2M+ attendees.",
  },
  {
    company_name: "MusicStream Plus",
    email: "hello@musicstream.com",
    niche: "Entertainment",
    location: "Nashville, USA",
    company_context: "Independent music streaming platform for emerging artists. 50K artists, 5M monthly listeners.",
  },
];

const NICHES = [
  "SaaS", "E-Commerce", "Digital Marketing", "Fintech", "Health Tech",
  "Real Estate", "Education", "Legal", "Consulting", "Venture Capital",
  "Data Analytics", "Agency", "Manufacturing", "Retail", "Media",
  "Clean Energy", "Logistics", "Travel", "Food Delivery", "Construction",
  "Agriculture", "Automotive", "Events", "Entertainment", "Public Relations"
];

export default function ScraperModule({ userId, onLeadsAdded, onGenerateEmails }: ScraperModuleProps) {
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");
  const [maxResults, setMaxResults] = useState(100);
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [isScaping, setIsScraping] = useState(false);
  const [results, setResults] = useState<ScrapedLead[]>([]);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [drawerLead, setDrawerLead] = useState<ScrapedLead | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [nicheSuggestions, setNicheSuggestions] = useState<string[]>([]);
  const [addingTocrm, setAddingToCrm] = useState(false);
  const [showBulkEmailSender, setShowBulkEmailSender] = useState(false);
  const pageSize = 25;

  const supabase = createClient();

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    const { data } = await supabase
      .from("lead_categories")
      .select("name")
      .eq("user_id", userId);
    if (data) {
      setCategories(data.map((c: any) => c.name));
    }
  };

  const handleNicheInput = (val: string) => {
    setNiche(val);
    if (val.length > 0) {
      setNicheSuggestions(
        NICHES.filter((n) => n.toLowerCase().includes(val.toLowerCase())).slice(0, 5)
      );
    } else {
      setNicheSuggestions([]);
    }
  };

  const handleScrape = async () => {
    if (!niche && !location) {
      toast.error("Please enter a niche or location");
      return;
    }
    
    setIsScraping(true);
    setResults([]);
    setSelectedRows(new Set());
    setCurrentPage(1);
    
    try {
      // Try real scraping first
      const scrapedData = await scrapeLeadsAction(niche, location, maxResults);
      
      if (scrapedData.success && scrapedData.leads.length > 0) {
        setResults(scrapedData.leads);
        toast.success(`Found ${scrapedData.leads.length} leads`);
      } else {
        // Fallback to filtered mock data with improved AND logic
        const filtered = MOCK_LEADS.filter((l) => {
          const nicheMatch = !niche || l.niche.toLowerCase().includes(niche.toLowerCase());
          const locMatch = !location || l.location.toLowerCase().includes(location.toLowerCase());
          
          // Use AND logic: both conditions must be true if both filters are provided
          if (niche && location) {
            return nicheMatch && locMatch;
          }
          // If only one filter is provided, use OR logic
          return nicheMatch || locMatch;
        });
        
        // Limit to maxResults
        const limitedResults = filtered.slice(0, maxResults);
        
        if (limitedResults.length > 0) {
          setResults(limitedResults);
          toast.success(`Found ${limitedResults.length} leads (using sample data)`);
        } else {
          // If no match, show all results up to maxResults
          toast.warning("No exact matches found. Showing available sample results.");
          setResults(MOCK_LEADS.slice(0, Math.min(maxResults, MOCK_LEADS.length)));
        }
      }
    } catch (error) {
      console.error('Scraping error:', error);
      toast.error("Scraping failed. Showing sample data.");
      
      // Fallback to mock data with improved filtering
      const filtered = MOCK_LEADS.filter((l) => {
        const nicheMatch = !niche || l.niche.toLowerCase().includes(niche.toLowerCase());
        const locMatch = !location || l.location.toLowerCase().includes(location.toLowerCase());
        
        if (niche && location) {
          return nicheMatch && locMatch;
        }
        return nicheMatch || locMatch;
      });
      
      const limitedResults = filtered.length > 0 
        ? filtered.slice(0, maxResults) 
        : MOCK_LEADS.slice(0, Math.min(maxResults, MOCK_LEADS.length));
      
      setResults(limitedResults);
    } finally {
      setIsScraping(false);
    }
  };

  const toggleRow = (idx: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    const pageLeads = paginated;
    const allSelected = pageLeads.every((_, i) => selectedRows.has((currentPage - 1) * pageSize + i));
    if (allSelected) {
      setSelectedRows(new Set());
    } else {
      const next = new Set<number>();
      pageLeads.forEach((_, i) => next.add((currentPage - 1) * pageSize + i));
      setSelectedRows(next);
    }
  };

  const addToCRM = async (leads: ScrapedLead[]) => {
    setAddingToCrm(true);
    try {
      // Use selected category or create from niche/location
      let finalCategory = category;
      
      if (!finalCategory) {
        finalCategory = niche && location 
          ? `${niche} - ${location}` 
          : niche || location || 'Uncategorized';
      }
      
      // Save category if new
      if (finalCategory && !categories.includes(finalCategory)) {
        await supabase.from("lead_categories").insert({
          user_id: userId,
          name: finalCategory,
        });
        setCategories([...categories, finalCategory]);
      }
      
      // Prepare inserts
      const basicInserts = leads.map((l) => ({
        user_id: userId,
        company_name: l.company_name,
        email: l.email,
        niche: l.niche,
        location: l.location,
        company_context: l.company_context,
        status: "New",
      }));
      
      const { data, error } = await supabase.from("leads").insert(basicInserts).select();
      
      // Check if error has any meaningful content
      const hasRealError = error && (
        (error.message && typeof error.message === 'string' && error.message.trim().length > 0) || 
        (error.details && typeof error.details === 'string' && error.details.trim().length > 0) || 
        (error.code && typeof error.code === 'string' && error.code.trim().length > 0) || 
        (error.hint && typeof error.hint === 'string' && error.hint.trim().length > 0)
      );
      
      if (hasRealError) {
        console.error('Database error:', error);
        throw new Error(
          error.message || 
          error.details || 
          error.hint ||
          'Database insert failed'
        );
      }
      
      // Success - update category manually after insert
      if (data && data.length > 0 && finalCategory) {
        const leadIds = data.map((d: any) => d.id);
        await supabase.rpc('update_lead_categories', {
          lead_ids: leadIds,
          new_category: finalCategory
        }).then(result => {
          if (result.error) {
            console.warn('Could not set category:', result.error);
          }
        });
      }
      
      toast.success(`${leads.length} lead(s) added to CRM${finalCategory ? ` under "${finalCategory}"` : ''}`);
      onLeadsAdded?.();
    } catch (e: unknown) {
      console.error('Add to CRM error:', e);
      
      let errorMessage = 'Failed to add to CRM';
      
      if (e instanceof Error) {
        errorMessage = e.message;
      } else if (typeof e === 'object' && e !== null) {
        const err = e as any;
        errorMessage = err.message || err.details || err.hint || 'Database error occurred';
      }
      
      if (errorMessage === 'Failed to add to CRM' || errorMessage === 'Database insert failed') {
        errorMessage = 'Failed to add to CRM. Check browser console for details.';
      }
      
      toast.error(errorMessage);
    } finally {
      setAddingToCrm(false);
    }
  };

  const exportCSV = () => {
    const csvLeads = selectedRows.size > 0
      ? Array.from(selectedRows).map((i) => results[i])
      : results;
    const headers = ["Company Name", "Email", "Niche", "Location", "Context"];
    const rows = csvLeads.map((l) => [
      l.company_name, l.email, l.niche, l.location, l.company_context.replace(/,/g, ";")
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads.csv";
    a.click();
  };

  const paginated = results.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const totalPages = Math.ceil(results.length / pageSize);
  const selectedLeads = Array.from(selectedRows).map((i) => results[i]).filter(Boolean);

  return (
    <div className="flex flex-col gap-6 p-6 h-full bg-white">
      {/* Search Panel */}
      <div className="rounded-xl p-5 bg-white border border-gray-200 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Radio size={16} className="text-blue-600" />
          <span className="text-sm font-semibold text-gray-900">
            Lead Scraper
          </span>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Niche input */}
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Industry / Niche (e.g. SaaS, E-Commerce)"
              value={niche}
              onChange={(e) => handleNicheInput(e.target.value)}
              className="w-full bg-white pl-9 pr-3 py-2.5 rounded-lg text-sm outline-none transition-all border border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            {nicheSuggestions.length > 0 && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-lg z-10 overflow-hidden shadow-lg border border-gray-200">
                {nicheSuggestions.map((s) => (
                  <button
                    key={s}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 transition-colors text-gray-700"
                    onClick={() => { setNiche(s); setNicheSuggestions([]); }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Location input */}
          <div className="relative flex-1">
            <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Location (City, Country, or Region)"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full bg-white pl-9 pr-3 py-2.5 rounded-lg text-sm outline-none transition-all border border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {/* Category selector */}
          <div className="relative flex-1">
            <select
              value={category}
              onChange={(e) => {
                if (e.target.value === "__new__") {
                  setShowNewCategory(true);
                  setCategory("");
                } else {
                  setCategory(e.target.value);
                  setShowNewCategory(false);
                }
              }}
              className="w-full bg-white pl-3 pr-3 py-2.5 rounded-lg text-sm outline-none transition-all border border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value="">Auto-generate category</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
              <option value="__new__">+ New Category</option>
            </select>
          </div>

          {/* Max results selector */}
          <div className="relative">
            <select
              value={maxResults}
              onChange={(e) => setMaxResults(Number(e.target.value))}
              className="bg-white pl-3 pr-3 py-2.5 rounded-lg text-sm outline-none transition-all border border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              title="Number of leads to scrape"
            >
              <option value={50}>50 leads</option>
              <option value={100}>100 leads</option>
              <option value={200}>200 leads</option>
              <option value={500}>500 leads</option>
              <option value={1000}>1000 leads</option>
            </select>
          </div>

          {/* Scrape button */}
          <button
            onClick={handleScrape}
            disabled={isScaping}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-all duration-300 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed ${isScaping ? "opacity-80" : ""}`}
            style={{ minWidth: "120px" }}
          >
            {isScaping ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Scraping...
              </>
            ) : (
              <>
                <Radio size={14} />
                Scrape
              </>
            )}
          </button>
        </div>
      </div>

      {/* Results Header with Actions */}
      {results.length > 0 && (
        <div className="rounded-xl p-4 bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                {results.length} Leads Found
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                Select leads or move all to CRM
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const allIndices = new Set(results.map((_, i) => i));
                  setSelectedRows(allIndices);
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                <CheckSquare size={14} />
                Select All
              </button>
              <button
                onClick={async () => {
                  setAddingToCrm(true);
                  await addToCRM(results);
                  setAddingToCrm(false);
                }}
                disabled={addingTocrm}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {addingTocrm ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Moving to CRM...
                  </>
                ) : (
                  <>
                    <Plus size={14} />
                    Move All to CRM ({results.length})
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Action Bar */}
      {selectedRows.size > 0 && (
        <div className="rounded-xl px-5 py-3 flex items-center justify-between bg-blue-50 border border-blue-200">
          <span className="text-sm text-blue-700 font-medium">
            {selectedRows.size} lead(s) selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => addToCRM(selectedLeads)}
              disabled={addingTocrm}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-green-100 border border-green-300 text-green-700 hover:bg-green-200"
            >
              {addingTocrm ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Add to CRM
            </button>
            <button
              onClick={() => setShowBulkEmailSender(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-purple-100 border border-purple-300 text-purple-700 hover:bg-purple-200"
            >
              <Zap size={12} />
              Generate & Send Bulk Emails
            </button>
            <button
              onClick={() => onGenerateEmails?.(selectedLeads)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-blue-100 border border-blue-300 text-blue-700 hover:bg-blue-200"
            >
              <ChevronRight size={12} />
              Generate Emails
            </button>
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-gray-100 border border-gray-300 text-gray-700 hover:bg-gray-200"
            >
              <Download size={12} />
              Export CSV
            </button>
            <button onClick={() => setSelectedRows(new Set())} className="text-gray-500 hover:text-gray-700">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Results Table */}
      {results.length > 0 && (
        <div className="rounded-xl overflow-hidden flex-1 border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left w-10">
                    <button onClick={toggleAll}>
                      {paginated.every((_, i) => selectedRows.has((currentPage - 1) * pageSize + i))
                        ? <CheckSquare size={14} className="text-blue-600" />
                        : <Square size={14} className="text-gray-400" />
                      }
                    </button>
                  </th>
                  {["Company", "Email", "Niche", "Location", ""].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[10px] font-semibold tracking-widest uppercase text-gray-600"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map((lead, i) => {
                  const globalIdx = (currentPage - 1) * pageSize + i;
                  const isSelected = selectedRows.has(globalIdx);
                  return (
                    <tr
                      key={globalIdx}
                      className={`border-b border-gray-100 transition-all duration-150 hover:bg-blue-50 group cursor-pointer ${isSelected ? 'bg-blue-50' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <button onClick={() => toggleRow(globalIdx)}>
                          {isSelected
                            ? <CheckSquare size={14} className="text-blue-600" />
                            : <Square size={14} className="text-gray-400" />
                          }
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-gray-900">
                          {lead.company_name}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-blue-600 font-mono">
                          {lead.email}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                          {lead.niche}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs flex items-center gap-1 text-gray-600">
                          <MapPin size={10} />
                          {lead.location}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setDrawerLead(lead)}
                            className="p-1.5 rounded-md transition-colors text-[10px] flex items-center gap-1 bg-gray-100 text-gray-700 hover:bg-gray-200"
                          >
                            <ExternalLink size={11} />
                            View
                          </button>
                          <button
                            onClick={async () => { await addToCRM([lead]); }}
                            className="p-1.5 rounded-md transition-colors text-[10px] flex items-center gap-1 bg-green-100 text-green-700 hover:bg-green-200"
                          >
                            <Plus size={11} />
                            CRM
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
              <span className="text-xs text-gray-600 font-mono">
                {results.length} results · Page {currentPage}/{totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1 rounded disabled:opacity-30 text-gray-600 hover:text-gray-900"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1 rounded disabled:opacity-30 text-gray-600 hover:text-gray-900"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {results.length === 0 && !isScaping && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center bg-blue-50 border border-blue-100">
              <Radio size={24} className="text-blue-600" />
            </div>
            <p className="text-sm font-medium text-gray-700">
              Enter a niche and location to find leads
            </p>
            <p className="text-xs mt-1 text-gray-500">
              Results will appear here after scraping
            </p>
          </div>
        </div>
      )}

      {/* Context Drawer */}
      {drawerLead && (
        <div className="fixed inset-0 z-50" onClick={() => setDrawerLead(null)}>
          <div className="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm" />
          <div
            className="absolute right-0 top-0 bottom-0 w-full max-w-md p-6 flex flex-col gap-4 overflow-y-auto bg-white border-l border-gray-200 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">
                Company Context
              </h2>
              <button onClick={() => setDrawerLead(null)} className="text-gray-500 hover:text-gray-700">
                <X size={18} />
              </button>
            </div>

            <div className="rounded-xl p-4 bg-blue-50 border border-blue-200">
              <p className="font-semibold text-base text-blue-900">
                {drawerLead.company_name}
              </p>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                  {drawerLead.niche}
                </span>
                <span className="text-xs flex items-center gap-1 text-gray-600">
                  <MapPin size={10} />
                  {drawerLead.location}
                </span>
              </div>
              <p className="text-xs mt-2 text-blue-600 font-mono">
                {drawerLead.email}
              </p>
            </div>

            <div>
              <p className="text-[10px] mb-2 uppercase tracking-widest text-gray-500 font-semibold">
                Company Overview
              </p>
              <p className="text-sm leading-relaxed text-gray-700">
                {drawerLead.company_context}
              </p>
            </div>

            <div className="flex gap-2 mt-auto pt-4 border-t border-gray-200">
              <button
                onClick={async () => { await addToCRM([drawerLead]); setDrawerLead(null); }}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 bg-green-100 border border-green-300 text-green-700 hover:bg-green-200"
              >
                <Plus size={14} /> Add to CRM
              </button>
              <button
                onClick={() => { onGenerateEmails?.([drawerLead]); setDrawerLead(null); }}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 bg-blue-100 border border-blue-300 text-blue-700 hover:bg-blue-200"
              >
                <Mail size={14} /> Write Email
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Bulk Email Sender Modal */}
      {showBulkEmailSender && (
        <BulkEmailSender
          userId={userId}
          selectedLeads={selectedLeads}
          onComplete={() => {
            setShowBulkEmailSender(false);
            setSelectedRows(new Set());
          }}
        />
      )}
    </div>
  );
}