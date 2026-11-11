// Hand-written payloads in the documented/observed shape of each provider. They exercise parsing; they are NOT recordings
// of live responses (the build sandbox could not reach any ATS host).
export const greenhouse = {
  jobs: [
    { id: 4001, title: "Senior Backend Engineer", absolute_url: "https://boards.greenhouse.io/acme/jobs/4001", location: { name: "Bengaluru, Karnataka, India" }, updated_at: "2026-10-30T10:00:00-04:00", first_published: "2026-10-20T09:00:00-04:00", content: "&lt;p&gt;Build services. 5-8 years of experience.&lt;/p&gt;", departments: [{ name: "Engineering" }], offices: [] },
    { id: 4002, title: "Data Scientist", absolute_url: "https://boards.greenhouse.io/acme/jobs/4002", location: { name: "Hyderabad, India" }, updated_at: "2026-10-31T10:00:00-04:00", content: "&lt;p&gt;Models.&lt;/p&gt;" },
    { id: 4003, title: "Account Executive", absolute_url: "https://boards.greenhouse.io/acme/jobs/4003", location: { name: "New York, NY" }, updated_at: "2026-10-31T10:00:00-04:00", content: "" },
    { id: 4004, title: "Platform Engineer", absolute_url: "https://boards.greenhouse.io/acme/jobs/4004", location: { name: "Bengaluru / Hyderabad" }, updated_at: "2026-10-31T10:00:00-04:00", content: "" },
    { id: 4005, title: "Support Engineer", absolute_url: "https://boards.greenhouse.io/acme/jobs/4005", location: { name: "Remote - India" }, updated_at: "2026-10-31T10:00:00-04:00", content: "" },
    { title: "No id — must be skipped", absolute_url: "https://boards.greenhouse.io/acme/jobs/x" },
  ],
  meta: { total: 6 },
};
export const lever = [
  { id: "lv-1", text: "Frontend Engineer", hostedUrl: "https://jobs.lever.co/acme/lv-1", applyUrl: "https://jobs.lever.co/acme/lv-1/apply", createdAt: 1761000000000, categories: { location: "Bangalore", allLocations: ["Bangalore", "Hyderabad"], commitment: "Full-time", team: "Web" }, workplaceType: "hybrid", descriptionPlain: "Work on UI. 3+ years.", salaryRange: { min: 2000000, max: 3500000, currency: "INR", interval: "per-year-salary" } },
  { id: "lv-2", text: "Product Designer", hostedUrl: "https://jobs.lever.co/acme/lv-2", createdAt: 1761100000000, categories: { location: "Remote, India", commitment: "Contract" }, workplaceType: "remote", descriptionPlain: "Design things." },
  { id: "lv-3", text: "Staff Engineer", hostedUrl: "https://jobs.lever.co/acme/lv-3", categories: { location: "Berlin, Germany" }, descriptionPlain: "" },
];
export const ashby = {
  apiVersion: "1",
  jobs: [
    { id: "as-1", title: "ML Engineer", location: "Hyderabad", secondaryLocations: [{ location: "Bengaluru" }], isRemote: false, workplaceType: "Hybrid", employmentType: "FullTime", publishedAt: "2026-10-25T08:00:00.000+00:00", jobUrl: "https://jobs.ashbyhq.com/acme/as-1", applyUrl: "https://jobs.ashbyhq.com/acme/as-1/application", descriptionPlain: "Train models. Minimum 4 years.", compensation: { summaryComponents: [{ compensationType: "Salary", minValue: 3000000, maxValue: 5000000, currencyCode: "INR", interval: "1 YEAR" }] } },
    { id: "as-2", title: "Unlisted role", location: "Bengaluru", isListed: false, jobUrl: "https://jobs.ashbyhq.com/acme/as-2" },
    { id: "as-3", title: "Support Lead", location: "India", isRemote: true, workplaceType: "Remote", employmentType: "FullTime", publishedAt: "2026-10-26T08:00:00.000+00:00", jobUrl: "https://jobs.ashbyhq.com/acme/as-3" },
  ],
};
export const smartrecruiters = (offset: number, total: number, n: number) => ({
  offset, limit: 100, totalFound: total,
  content: Array.from({ length: n }, (_, i) => ({ id: `sr-${offset + i}`, name: `Engineer ${offset + i}`, releasedDate: "2026-10-22T05:00:00.000Z", location: { city: i % 2 ? "Bengaluru" : "Pune", region: "KA", country: "in", remote: false }, typeOfEmployment: { label: "Full-time" }, experienceLevel: { label: "Mid-Senior Level" } })),
});
export const workable = { name: "Acme", jobs: [{ title: "DevOps Engineer", shortcode: "WK1", url: "https://apply.workable.com/j/WK1", application_url: "https://apply.workable.com/j/WK1/apply", published_on: "2026-10-27", employment_type: "Full-time", department: "Eng", locations: [{ city: "Hyderabad", region: "Telangana", country: "India" }], description: "<p>Run infra</p>" }, { title: "Remote Writer", shortcode: "WK2", url: "https://apply.workable.com/j/WK2", telecommuting: true, locations: [{ country: "India" }] }] };
export const recruitee = { offers: [{ id: 77, title: "QA Engineer", slug: "qa-engineer", careers_url: "https://acme.recruitee.com/o/qa-engineer", careers_apply_url: "https://acme.recruitee.com/o/qa-engineer/c/new", location: "Bangalore, India", remote: false, status: "published", published_at: "2026-10-21 13:16:05 UTC", description: "<p>Test</p>", requirements: "<p>2-4 years</p>" }, { id: 78, title: "Draft", status: "draft", careers_url: "https://acme.recruitee.com/o/draft" }] };
export const breezy = [{ id: "bz1", friendly_id: "bz1-sre", name: "SRE", url: "https://acme.breezy.hr/p/bz1-sre", published_date: "2026-10-24T00:00:00.000Z", location: { name: "Hyderabad, TG", city: "Hyderabad", country: { name: "India" }, is_remote: false }, type: { name: "Full-Time" }, department: "Platform" }];
export const keka = [{ id: 501, title: "HR Executive", description: "<p>People ops</p>", experience: "2-4", jobLocations: [{ city: "Bengaluru", state: "Karnataka", countryName: "India" }], publishedOn: "2026-10-23T00:00:00Z", departmentName: "HR" }];
export const darwinbox = { status: "success", job_counts: 2, data: [{ id: "d1", designation_title: "Java Developer", officelocation_show_arr: ["Hyderabad"], country: "India", is_remote: 0, employee_type: "Permanent", experience: "3-6 years", jd: "<p>Java</p>", created_on: "2026-10-20 10:00:00" }, { id: "d2", designation: "Remote Analyst", officelocation_arr: [], country: ["India"], is_remote: "1", created_on: 1761000000 }] };
export const workday = (offset: number, total: number, n: number) => ({ total: offset === 0 ? total : 0, jobPostings: Array.from({ length: n }, (_, i) => ({ title: `Analyst ${offset + i}`, externalPath: `/job/Bangalore/Analyst-${offset + i}_R${1000 + offset + i}`, locationsText: i % 3 === 0 ? "3 Locations" : "Bangalore, India", postedOn: i % 2 ? "Posted 5 Days Ago" : "Posted 30+ Days Ago", bulletFields: [`R${1000 + offset + i}`] })) });
export const personioXml = `<?xml version="1.0" encoding="UTF-8"?><workzag-jobs><position><id>9001</id><office>IN_Bangalore</office><additionalOffices><office>Hyderabad</office></additionalOffices><department>Eng</department><recruitingCategory>Tech</recruitingCategory><name>Backend Engineer</name><jobDescriptions><jobDescription><name>Tasks</name><value><![CDATA[<p>APIs</p>]]></value></jobDescription></jobDescriptions><employmentType>permanent</employmentType><seniority>experienced</seniority><schedule>full-time</schedule><yearsOfExperience>2-5</yearsOfExperience><createdAt>2026-10-19T10:00:00+00:00</createdAt></position><position><id>9002</id><office>Munich</office><name>Sales Rep</name><createdAt>2026-10-18T10:00:00+00:00</createdAt></position></workzag-jobs>`;
