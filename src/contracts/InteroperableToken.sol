pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "./IInteroperableToken.sol";

contract InteroperableToken is ERC20, AccessControlEnumerable, IInteroperableToken {

  // There are different admin roles for extra security
  bytes32 public constant SUPPLY_CONTROL_ROLE = keccak256("SUPPLY_CONTROL_ADMIN_ROLE");
  bytes32 public constant TORNADO_ROLE = keccak256("TORNADO_ADMIN_ROLE");
  bytes32 public constant INSTITUTION_ROLE = keccak256("INSTITUTION_ADMIN_ROLE");
  bytes32 public constant USER_ROLE = keccak256("USER_ADMIN_ROLE");
  bytes32 public constant AUTHORISED_ROLE = keccak256("AUTHORISED_USER_ROLE");
  // There is a list of registered institutions, 
  // as only burns to registered Institutions will be allowed,
  // and only if there is a mutual recognition between institutions
  mapping(string => address) public registeredInstitutions;
  // There is a list of tornado contracts to use.
  // They are indexed from denomination to tornado contract address
  mapping(uint256 => address) public registeredTornadoDenominations;
  // We have added additional burn and mint events to record the related ZKP escrow elements
  event BurnToZKPEscrow(uint256[] amounts, bytes32[] commitments, string institution, address institutionAddress);
  event MintToZKPEscrow(address to, uint256[] amounts, bytes32[] commitments);

  /**
   * @dev Initialises the extended ERC20 contract with initialise roles and some initial supply
   * @param name - name of the currency
   * @param currency - the currency symbol
   * @param initialSupply - the initial supply of this ERC20 token, all provided to the msg.sender
   * @param accessControlAdmin - which address can add or delete access roles
   * @param tornadoAdmin - which address can add new tornado contracts 
   * @param institutionAdmin - which address can add or delete institutions
   * @param userAdmin - which address can add or delete authorised user addresses
   * @param supplyControlAdmin - which address can mint new currency
   */
  constructor(string memory name,
              string memory currency,
              string memory thisInstitutionName,
              uint256 initialSupply,
              address accessControlAdmin,
              address tornadoAdmin,
              address institutionAdmin,
              address userAdmin,
              address supplyControlAdmin) ERC20(name, currency) {
    //sets up the admin roles. Can be separate from the deployer address
    _setupRole(DEFAULT_ADMIN_ROLE, accessControlAdmin);
    _setupRole(TORNADO_ROLE, tornadoAdmin);
    _setupRole(INSTITUTION_ROLE, institutionAdmin);
    grantRole(INSTITUTION_ROLE, address(this)); //allows to connect to itself in the constructor
    _setupRole(USER_ROLE, userAdmin);
    _setupRole(SUPPLY_CONTROL_ROLE, supplyControlAdmin);
    _setupRole(AUTHORISED_ROLE, msg.sender);
    grantRole(AUTHORISED_ROLE, address(this));
    //provides initial tokens
    _mint(msg.sender, initialSupply);
    //allows ZKP transfers within the same institution
    addOrDeleteInstitution(thisInstitutionName, address(this), true);
  }

      /**
     * @dev Returns the number of decimals used to get its user representation.
     * For example, if `decimals` equals `2`, a balance of `505` tokens should
     * be displayed to a user as `5.05` (`505 / 10 ** 2`).
     *
     */
    function decimals() public view virtual override returns (uint8) {
        return 2;
    }

  /**
   * @dev adds a tornado cash contract to the list of connected tornado contracts, assigning it a particular denomination. 
   * @param tornado - the tornado cash ZKP escrow contract address
   * Requirements:
   * - the caller must have the `TORNADO_ROLE`.
   */
  function addTornadoContract(address tornado) public {
    require(tornado != address(0x0), "Contract address is null");
    require(hasRole(TORNADO_ROLE, msg.sender), "Must have TORNADO_ROLE role to connect a new contract");
    // the denomination value assigned to this contract
    Tornado tornadoContract = Tornado(tornado);
    uint256 denomination = tornadoContract.denomination();
    require(registeredTornadoDenominations[denomination] == address(0x0), "Denomination has already been set");
    require(denomination > 0, "Denomination cannot be 0");
    // connect tornado cash contract
    registeredTornadoDenominations[denomination] = tornado;
    // allows the tornado contract to receive tokens:
    grantRole(AUTHORISED_ROLE, tornado);
  }

  /**
   * @dev Adds or deletes an institution from the list of where users can transfer burns to. A newly linked institution is provided
   * the SUPPLY_CONTROL_ROLE role so that its smart contract can automatically trigger minting in this contract when a burn has been completed.
   * @param institution - the name of the institution being connected to
   * @param institutionAddress - the address of the institution's smart contract
   * @param approved - if the institution is approved for transfers (true) or disapproved (false)
   * Requirements:
   * - the caller must have the `INSTITUTION_ROLE`.
   */
  function addOrDeleteInstitution(string memory institution, address institutionAddress, bool approved) public {
    require(hasRole(INSTITUTION_ROLE, msg.sender), "Must have INSTITUTION_ROLE role to add or removed institutions");
    if (approved == true) {
      // connect to institution
      registeredInstitutions[institution] = institutionAddress;
      grantRole(SUPPLY_CONTROL_ROLE, institutionAddress);
      grantRole(AUTHORISED_ROLE, institutionAddress);
    } else {
      // disconnect from institution
      registeredInstitutions[institution] = address(0x0);
      revokeRole(SUPPLY_CONTROL_ROLE, institutionAddress);
      revokeRole(AUTHORISED_ROLE, institutionAddress);
    }
  }

  /**
   * @dev Adds or deletes a user from the authorised user list
   * @param user - the user being added or deleted
   * @param approved - is the user now approved (true) or not (false)
   * Requirements:
   * - the caller must have the `USER_ROLE`.
   */
  function addOrDeleteAuthorisedUser(address user, bool approved) public {
    require(hasRole(USER_ROLE, msg.sender), "Must have the USER_ROLE role to change the authorised user list");
    // change the authorised user list
    if (approved == true) {
      grantRole(AUTHORISED_ROLE, user);
    } else {
      revokeRole(AUTHORISED_ROLE, user);
    }
  }

  /**
   * @dev Creates `amount` new tokens and deposits them in the ZKP contracts(of the given amount denominations) locked to the given commitments.
   * @param totalAmount - the total amount of the currency to transfer to the receiving institution
   * @param amounts - the different denominations that make up the totalAmount
   * @param commitments - the commitments corresponding to the secrets required to generate the ZKPs to withdraw this totalAmount from the ZKP escrow for each separate denomination
   * Requirements:
   * - amount[x] corresponds to commitment[x]
   * - note that x < y, where y is the block gas limit (y is blockchain specific). 
   * - the caller must have the `SUPPLY_CONTROL_ROLE`.
   */
  function mintToZKPEscrow(uint256 totalAmount, uint256[] memory amounts, bytes32[] memory commitments) public override {
    require(hasRole(SUPPLY_CONTROL_ROLE, msg.sender), "Must have supply control role to mint");
    require(amounts.length == commitments.length, "There should be an equal number of amounts and commitments");
    uint256 count;
    uint256 runningTotal;
    address tornado;
    uint256 thisAmount;
    // mint to this contract before transfering to the ZKP escrow
    _mint(address(this), totalAmount);
    emit MintToZKPEscrow(address(this), amounts, commitments);
    while (count < amounts.length) {
      thisAmount = amounts[count];
      require(registeredTornadoDenominations[thisAmount] != address(0x0), "Denomination for tornado cash has NOT been set");
      runningTotal += thisAmount;
      // approve tornado cash to take funds into ZKP escrow
      tornado = registeredTornadoDenominations[thisAmount];
      _approve(address(this), tornado, thisAmount);
      // move funds into ZKP escrow
      Tornado tornadoContract = Tornado(tornado);
      // these contracts have been added by us and so we are safe from re-entrancy attack
      tornadoContract.deposit(commitments[count]);
      count++;
    }
    require(runningTotal == totalAmount, "Running total not equal to totalAmount");
  }

    /** @dev Creates more tokens without sending them to the ZKP escrow.
     * @param amount - the number of tokens to create
     * @param account - the tokens will we assigned to this address
     *
     * Requirements:
     *
     * - the caller must have the `SUPPLY_CONTROL_ROLE`.
     */
  function mint(address account, uint256 amount) public {
    require(hasRole(SUPPLY_CONTROL_ROLE, msg.sender), "Must have supply control role to mint");
    _mint(account, amount);
  }

  /**
   * @dev Destroys `amount` tokens from the caller and automatically mints them in the given institution's ERC20 contract
   * @param totalAmount - the total amount of the currency to transfer to the receiving institution
   * @param amounts - the different denominations that make up the totalAmount
   * @param commitments - the commitments corresponding to the secrets required to generate the ZKPs to withdraw this totalAmount from the ZKP escrow for each separate denomination
   * @param institution - the institution to transfer this currency to
   *
   * Requirements:
   * - amount[x] corresponds to commitment[x]
   * - note that x < y, where y is the block gas limit (y is blockchain specific). 
   */
  function burnAndTransferToConnectedInstitution(uint256 totalAmount, uint256[] memory amounts, bytes32[] memory commitments, string memory institution) public override {
    require(registeredInstitutions[institution] != address(0x0), "Institution being sent currency is not connected");
    _burn(msg.sender, totalAmount);
    emit BurnToZKPEscrow(amounts, commitments, institution, registeredInstitutions[institution]);
    //trigger mint function on the other institution's ERC20 contract
    IInteroperableToken otherInstitution = IInteroperableToken(registeredInstitutions[institution]);
    //note that if there is an error on the calling contract (e.g. out of gas), this error will ripple up (as we want it to)
    otherInstitution.mintToZKPEscrow(totalAmount, amounts, commitments);
  }

  /**
     * @dev Destroys tokens from the caller without sending them to another institution.
     * @param amount - the number of tokens to destroy

     * Requirements:
     *
     * - the caller must have the `SUPPLY_CONTROL_ROLE`.
   */
  function burn(uint256 amount) public {
    require(hasRole(SUPPLY_CONTROL_ROLE, msg.sender), "Must have supply control role to mint");
    _burn(msg.sender, amount);
  }

  /**
   * @dev Hook that is called before any transfer of tokens. This includes
   * minting and burning.
   *
   * Calling conditions:
   *
   * - when `from` and `to` are both non-zero, `amount` of ``from``'s tokens
   * will be to transferred to `to`.
   * - when `from` is zero, `amount` tokens will be minted for `to`.
   * - when `to` is zero, `amount` of ``from``'s tokens will be burned.
   * - `from` and `to` are never both zero.
   * - both sender and receiver must be authorised
   *
   */
  function _beforeTokenTransfer(address from, address to, uint256) internal view override {
    //address(0x0) allows for mint and burns
    require((hasRole(AUTHORISED_ROLE, from)) || (from == address(0x0)), "Sender must be authorised");
    require((hasRole(AUTHORISED_ROLE, to)) || (to == address(0x0)), "Receiver must be authorised");
  }

}

interface Tornado {

  function denomination() external view returns(uint256);

  function deposit(bytes32 _commitment) external payable;

  function withdraw(bytes calldata _proof, bytes32 _root, bytes32 _nullifierHash, address payable _recipient, address payable _relayer, uint256 _fee, uint256 _refund) external payable;
}
