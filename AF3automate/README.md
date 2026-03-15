The script(AF3jobautomation.py) is intended to use as a way to automate job submission in the AF3 server. 
Only known to work with windows and GOOGLE CHROME for now(I have yet to test compatibility with other OS). 
The script takes in an fasta file in the same directory(specify file name in script). It will ONLY submit monomeric proteins and nothing else.
This may change in the future to provide more functionality. 

**DISCLAIMER**: THIS SCRIPT ONLY GUARANTEES ENTRY OF THE JOBS. DOES NOT GUARANTEE WHETHER OR NOT AF3 CAN SUCCESSFULLY PREDICT YOUR JOBS. TO ALIGN WITH TERMS AND CONDITIONS SET BY THE GOOGLE DEEPMIND ALPHAFOLD SERVER, THIS SCRIPT SHOULD ONLY BE USED FOR NON-COMMERCIAL PURPOSES. uwu pls i dont wanna get sued

**Prerequisites for use**:

- Open a google chrome instance in remote debugging mode

>cd C:\path\to\your\chrome\exe
>chrome --remote-debugging-port=9222 --user-data-dir=C:\path\to\your\custom\profile
>type in browser: chrome://inspect/#remote-debugging and enable remote debugging
>if successful, type in the web browser: http://localhost:9222/json 
>if you are using a different port, make sure that you change the INSTANCE in config.txt to reflect change

- Have playwright python installed 

-look up documentation on official website: https://playwright.dev/python/docs/intro

- Log in to AF3 server in your remote debugging chrome browser

**How To Use**:
1. Upload fasta file to the same folder as AF3jobautomation.py script
2. Check if URL, INSTANCE, and FASTA_FILE_NAME in the config.txt are correct
3. Navigate to the AF3 server tab, make sure you are at the page where the sequences can be inputted
4. in a terminal: 
        cd C:\path\to\script\folder 
5. then: 
        py AF3jobautomation.py

