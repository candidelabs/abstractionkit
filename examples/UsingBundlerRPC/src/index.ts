import {Bundler} from "abstractionkit";


async function main(): Promise<void> {
    let bundler: Bundler = new Bundler(
        "https://goerli.voltaire.candidewallet.com/rpc",
        "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"
    );
    
    //an example for using a bundler json rpc methods other than sendUserOperation and estimateUserOperationGas which is covered in another example
    const userOperationHash = "0xb348b32bc9b9e90620839c3926db401558806b03b2a46dc6de21d3a4ed8412fb" //an example userOperationHash in goerli chain
    console.log(await bundler.chainId())
    console.log(await bundler.supportedEntryPoints())
    console.log(await bundler.getUserOperationByHash(userOperationHash))
    console.log(await bundler.getUserOperationReceipt(userOperationHash))
}

main()