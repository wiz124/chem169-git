##################|Example of what config.txt should look like|#######################
# INSTANCE='http://localhost:9222'

# FASTA_FILE_NAME='test.fasta'
#################################################################


import time,sys
from playwright.sync_api import sync_playwright, Page

def writeFasta(proteins,file_name):
    with open(file_name,'w') as f:
        for key,value in proteins.items():
            f.write(f'>|{key}\n')
            f.write(value+'\n')

def jobSummary(result):
    totalErrors=len(result['errors'])
    leftover_jobs_total=len(result['leftover_jobs'])

    print(f'Automation of AF3 jobs encountered {totalErrors} errors')
    print(f'There are {leftover_jobs_total} jobs leftover to do')

    writeFasta(result['errors'],'errors.fasta')
    writeFasta(result['leftover_jobs'], 'unsubmitted.fasta')

    print(f'Outputted unsubmitted/unsuccessful jobs to unsubmitted.fasta and errors.fasta respectively')

def submitJobs(entry_dict,page:Page):
        
        jobErrors={}
        for key,value in entry_dict.items():
            try:
                page.keyboard.press('Escape')
                page.get_by_role("button", name="Clear").click()
                page.get_by_role("textbox", name="Input").click()
                page.get_by_role("textbox", name="Input").fill(value)
                page.get_by_role("button", name="Continue and preview job").click()
                page.get_by_role("textbox", name="Job name").click()
                page.get_by_role("textbox", name="Job name").fill(key)
                page.get_by_role("button", name="Confirm and submit job").click()
                
                #waits for page to update then loops to wait until latest job is finished 
                page.locator('mat-spinner').wait_for(state='visible')
                goNext=False
                while goNext==False:
                    goNext=page.locator('mat-spinner').is_hidden()
                    time.sleep(5)

                del entry_dict[key]
            except:
                jobErrors[key]=value
                continue
        
        
        return {'errors':jobErrors,'leftover_jobs':entry_dict}

def parseFasta(fastafile):
    entry_dict={}
    with open(fastafile, 'r') as f:
        for line in f:
            if '>' in line:
                sequence=''
                name=''
                name=line.split('|')[1]
                entry_dict[name]=''
            else:
                entry_dict[name]+=line.strip()
    return entry_dict

def checkForAF3(all_pages:Page,URL):
    page=''
    for idx,tab in enumerate(all_pages):

        #confirm AF3 server tab exists
        if URL in tab.url and tab.locator('gdm-af-explainer').is_visible():
            # page=all_pages[i].bring_to_front()
            print('='*80)
            print('Located Alphafold server')
            print('='*80)
            return idx


    if page=='':
        print('*'*80)
        print('!!!ERROR!!! No alphafold server tab exists or is logged into')
        print('Open AF3 to server interface and please try again')
        print('*'*80)
        sys.exit()
        return False

def readConfig():
    configs={'INSTANCE':'','FASTA_FILE_NAME':''}
    with open('config.txt','r') as f:
        for line in f:
            if 'INSTANCE' in line:
                configs['INSTANCE']=line.split('=')[1].strip()
            if 'FASTA_FILE_NAME' in line:
                configs['FASTA_FILE_NAME']=line.split('=')[1].strip()
    
    return configs

def run(playwright):

    configs=readConfig()
    URL='https://alphafoldserver.com/'
    entry_dict=parseFasta(configs['FASTA_FILE_NAME'])

    if not entry_dict:
        print('!!!ERROR!!! Empty fasta file')
        sys.exit()
    try:
        browser=playwright.chromium.connect_over_cdp(configs['INSTANCE'])
    except:
        print('Trouble connecting to Chrome')
        sys.exit()

    default_context=browser.contexts[0]
    all_pages=default_context.pages

    #check if AF3 tab exists and on correct interface
    idx=checkForAF3(all_pages, URL)
    if idx:
        page=all_pages[idx]
        page.bring_to_front() #bringtofront returns a nulltype value

        #begin automation   
        print('Beginning job submissions')
        result=submitJobs(entry_dict,page)
        
        jobSummary(result)

    else:
        sys.exit()


with sync_playwright() as playwright:  
    run(playwright)    

