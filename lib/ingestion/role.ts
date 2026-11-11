// Role family from the job TITLE only. Order matters (first match wins). "other" is a real answer.
const RULES: [string, RegExp][] = [
  ["security", /\b(security|infosec|appsec|penetration|soc analyst)\b/i],
  ["devops_sre", /\b(devops|sre|site reliability|platform engineer|infrastructure|cloud engineer|systems engineer)\b/i],
  ["data_ml", /\b(data scientist|data engineer|machine learning|ml engineer|ai engineer|ai\/ml|research scientist|analytics engineer|nlp|computer vision|llm|data analyst|business analyst|bi developer)\b/i],
  ["qa", /\b(qa|quality assurance|sdet|test engineer|automation tester|tester)\b/i],
  ["design", /\b(designer|ux|ui\/ux|product design|graphic|creative director|illustrator|design lead)\b/i],
  ["product_management", /\b(product manager|product owner|program manager|technical program|group product|apm\b|head of product)\b/i],
  ["software_engineering", /\b(software|developer|engineer|sde|programmer|full[- ]?stack|front[- ]?end|back[- ]?end|mobile|android|ios|java|python|golang|node|react|swe)\b/i],
  ["sales", /\b(sales|account executive|business development|bdr|sdr|account manager|inside sales)\b/i],
  ["marketing", /\b(marketing|growth|seo|content|brand|social media|copywriter|communications|pr manager)\b/i],
  ["customer_success", /\b(customer success|customer support|support specialist|customer experience|technical support|implementation)\b/i],
  ["hr", /\b(recruiter|talent acquisition|human resources|hr\b|people (partner|operations|ops)|hrbp)\b/i],
  ["finance", /\b(finance|accountant|accounting|fp&a|controller|auditor|tax|treasury|payroll)\b/i],
  ["operations", /\b(operations|supply chain|logistics|procurement|program coordinator|administrator|office manager)\b/i],
];
export function roleFamily(title: string): string {
  for (const [fam, re] of RULES) if (re.test(title)) return fam;
  return "other";
}
