// Deliberate fixtures for offline verification only. This is not an LLM or research evidence.
export const fixtureDesign={title:'Collaboration history and partner choice',researchQuestion:'How does prior collaboration change selection of the designated partner?',xLabel:'Prior collaboration',yLabel:'Partner selection',unit:'A firm choosing a partner',decisionTask:'Choose a partner for the next project, or state that no preference is supported.',x0:'The firm has not collaborated with the designated partner.',x1:'The firm has successfully collaborated with the designated partner.',sharedFacts:['Both partners can complete the project.','The project has a fixed budget.'],positiveOption:'Select the designated partner.',negativeOption:'Select the alternative partner.',baselineTitle:'Standard project',baselineFacts:['Both partners quote the same price.','Both partners meet the technical requirements.'],assumptions:['Partner selection is a narrow proxy; it does not measure long-term performance.'],sourceNotes:['This offline fixture is researcher-written and contains no paper evidence.']};
export class FixtureModel {
  constructor(onCall=()=>{}){this.onCall=onCall;this.calls=[];}
  async call(role,system,payload){
    this.calls.push({role,system,payload:structuredClone(payload)});this.onCall(role,system,payload);
    if(role==='extract')return{paperTitle:'Researcher-written example',suggestions:[],caveats:['No empirical relationship is established by this fixture text.']};
    if(role==='design')return structuredClone(fixtureDesign);
    if(role==='plan')return{
      candidates:payload.candidateIds.map((id,index)=>({id,title:`Project conditions ${payload.round}.${index+1}`,summary:'A complete fixture context with a distinct external delivery constraint.',facts:[`The delivery window is ${10+payload.round*6+index} days.`,index%2?'Independent certification covers both partners.':'The project uses the standard technical specification.'],attributes:[{name:'Delivery window',level:`${10+payload.round*6+index} days`}],inspiration:{type:'unexplored',text:'Exercise a new setting in the offline test.',sourceIds:[]},expectedEffect:'uncertain',prediction:'No empirical prediction is made for fixture data.',learningValue:'Exercise state, validation, memory and accounting.'})),selectedIds:payload.candidateIds.slice(0,payload.contextsPerRound),rationale:'The selected fixtures exercise two independent context records.'};
    if(role==='review')return{approved:true,issues:[]};
    if(role==='actor'){
      const x=payload.facts.find(f=>f.id==='X').text;
      if(x.includes('not collaborated'))return{choice:'NO_PREFERENCE',noPreferenceReason:'equivalent',justification:'Both feasible actions remain supported under the supplied reference information.',factIds:['S1','X']};
      return{choice:payload.options.find(o=>o.text===fixtureDesign.positiveOption).label,noPreferenceReason:null,justification:'The prior successful collaboration supports the designated action in this test fixture.',factIds:['X']};
    }
    if(role==='reflect')return{observed:'The fixture model followed its programmed rule. These outcomes test the pipeline and are not empirical findings.',learned:['Neutral choices remain in the denominator.'],nextQuestions:['Which external condition should a real model explore next?'],strategyLessons:[`Round ${payload.round} fixtures have been evaluated; avoid repeating their delivery windows.`],sourceContextIds:payload.currentRound.map(c=>c.id)};
    if(role==='report')return{title:'Offline workflow demonstration',overview:'This report exercises the complete local workflow with deterministic responses. It is a software check and contains no model-generated research results.',executiveSummary:{takeaway:'The offline workflow completed successfully.',patterns:['Each context has a complete paired decision sample.'],nextStep:'Configure an API provider and start a new run to conduct an actual exploration.'},findings:[{title:'Complete accounting',text:'The pipeline preserved all accepted decision slots and their stated reasons.',contextIds:['baseline']}],nextStudies:['In a real study, vary a delivery constraint and measure partner choices in an independent sample.'],limitations:['The fixture model is a programmed software test, not an LLM.']};
    throw new Error(`Unknown fixture role ${role}.`);
  }
}
export class FixtureProvider {
  constructor(model=new FixtureModel()){this.model=model;}
  async request(role,system,payload){return{content:JSON.stringify(await this.model.call(role,system,payload)),finishReason:'stop',providerModel:'offline-fixture',usage:{},attempts:0};}
  close(){}
}
