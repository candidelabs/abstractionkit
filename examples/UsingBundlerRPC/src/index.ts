import {Bundler} from "abstractionkit";


async function main(): Promise<void> {
    let bundler: Bundler = new Bundler(
        "https://sepolia.voltaire.candidewallet.com/rpc",
    );
    
    //an example for using a bundler json rpc methods other than sendUserOperation and estimateUserOperationGas which is covered in another example
    const userOperationHash = "0x321e3d42534cbadee202ca921df689942803af1db7dbb860ec9cd1de9a7d3cfb" //an example userOperationHash in sepolia chain
    console.log(await bundler.chainId())
    console.log(await bundler.supportedEntryPoints())
    console.log(await bundler.getUserOperationByHash(userOperationHash))
    console.log(await bundler.getUserOperationReceipt(userOperationHash))
}

main()